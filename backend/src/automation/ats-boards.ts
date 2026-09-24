/**
 * ats-boards.ts
 *
 * Discovery straight from hosted ATS job boards.
 *
 * The job-aggregator route (WeWorkRemotely, RemoteOK) does not survive contact
 * with production: WWR sits behind a Cloudflare managed challenge that returns
 * 403 to any non-browser client, and RemoteOK routes its apply links through a
 * gated redirect that bounces scrapers back to its own site. Neither yields a
 * URL we can submit a form to.
 *
 * Greenhouse, Lever and Ashby, by contrast, all publish unauthenticated JSON
 * board APIs, and every posting carries a direct apply URL on the ATS itself.
 * That removes the resolution step entirely — a job discovered here is already
 * known to be drivable.
 *
 * Boards come from the ATS_BOARDS env var, comma separated:
 *     ATS_BOARDS="greenhouse:anthropic,ashby:ramp,lever:matchgroup"
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";
import { getJson, mapWithConcurrency, httpLimits } from "../utils/http.js";
import type { Job, UserProfile } from "../types/index.js";
import type { AtsName } from "./ats.js";

export interface BoardRef {
  ats: AtsName;
  token: string;
}

const DEFAULT_BOARDS: BoardRef[] = [
  { ats: "greenhouse", token: "anthropic" },
  { ats: "greenhouse", token: "databricks" },
  { ats: "greenhouse", token: "figma" },
  { ats: "ashby",      token: "ramp" },
  { ats: "ashby",      token: "linear" },
  { ats: "lever",      token: "matchgroup" },
];

export function configuredBoards(): BoardRef[] {
  const raw = process.env.ATS_BOARDS?.trim();
  if (!raw) return DEFAULT_BOARDS;

  const boards: BoardRef[] = [];
  for (const entry of raw.split(",")) {
    const [ats, token] = entry.trim().split(":");
    if (!ats || !token) continue;
    if (ats === "greenhouse" || ats === "lever" || ats === "ashby") {
      boards.push({ ats, token: token.trim() });
    } else {
      logger.warn(`[ats-boards] Unsupported ATS in ATS_BOARDS: "${ats}"`);
    }
  }
  return boards.length > 0 ? boards : DEFAULT_BOARDS;
}

interface BoardJob {
  ats: AtsName;
  externalId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  remote: boolean;
  employmentType: string | null;
  postedAt: string | null;
}

const stripHtml = (s: string): string =>
  s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

// ─── Greenhouse ───────────────────────────────────────────────────────────────

async function fetchGreenhouse(token: string): Promise<BoardJob[]> {
  const res = await getJson<{ jobs?: Array<Record<string, any>> }>(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    { headers: { Accept: "application/json" } }
  );
  if (res.status !== 200 && !res.fromCache) {
    logger.warn(`[ats-boards] greenhouse/${token}: HTTP ${res.status}`);
    return [];
  }

  const jobs = (res.data?.jobs ?? []) as Array<Record<string, any>>;
  return jobs
    // Some companies point absolute_url at their own careers site, which we
    // cannot drive. Keep only postings hosted on Greenhouse itself.
    .filter((j) => /(?:job-boards|boards)\.greenhouse\.io/i.test(String(j.absolute_url ?? "")))
    .map((j) => {
      const location = String(j.location?.name ?? "");
      return {
        ats: "greenhouse" as const,
        externalId: `greenhouse:${token}:${j.id}`,
        title: String(j.title ?? ""),
        company: String(j.company_name ?? token),
        location,
        description: stripHtml(String(j.content ?? "")).slice(0, 4000),
        applyUrl: String(j.absolute_url),
        remote: /remote/i.test(location),
        employmentType: null,
        postedAt: j.updated_at ? String(j.updated_at) : null,
      };
    });
}

// ─── Lever ────────────────────────────────────────────────────────────────────

async function fetchLever(token: string): Promise<BoardJob[]> {
  const res = await getJson<Array<Record<string, any>>>(
    `https://api.lever.co/v0/postings/${token}?mode=json`,
    { headers: { Accept: "application/json" } }
  );
  if ((res.status !== 200 && !res.fromCache) || !Array.isArray(res.data)) {
    logger.warn(`[ats-boards] lever/${token}: HTTP ${res.status}`);
    return [];
  }

  return (res.data as Array<Record<string, any>>).map((j) => {
    const location = String(j.categories?.location ?? "");
    return {
      ats: "lever" as const,
      externalId: `lever:${token}:${j.id}`,
      title: String(j.text ?? ""),
      company: token,
      location,
      description: String(j.descriptionPlain ?? "").slice(0, 4000),
      applyUrl: String(j.hostedUrl ?? ""),
      remote: /remote/i.test(location) || /remote/i.test(String(j.workplaceType ?? "")),
      employmentType: j.categories?.commitment ? String(j.categories.commitment) : null,
      postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
    };
  }).filter((j) => j.applyUrl);
}

// ─── Ashby ────────────────────────────────────────────────────────────────────

async function fetchAshby(token: string): Promise<BoardJob[]> {
  const res = await getJson<{ jobs?: Array<Record<string, any>>; name?: string }>(
    `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    { headers: { Accept: "application/json" } }
  );
  if (res.status !== 200 && !res.fromCache) {
    logger.warn(`[ats-boards] ashby/${token}: HTTP ${res.status}`);
    return [];
  }

  const jobs = (res.data?.jobs ?? []) as Array<Record<string, any>>;
  return jobs.map((j) => ({
    ats: "ashby" as const,
    externalId: `ashby:${token}:${j.id ?? j.jobUrl}`,
    title: String(j.title ?? ""),
    company: String(res.data?.name ?? token),
    location: String(j.location ?? ""),
    description: stripHtml(String(j.descriptionHtml ?? j.descriptionPlain ?? "")).slice(0, 4000),
    applyUrl: String(j.applyUrl ?? j.jobUrl ?? ""),
    remote: Boolean(j.isRemote) || /remote/i.test(String(j.location ?? "")),
    employmentType: j.employmentType ? String(j.employmentType) : null,
    postedAt: j.publishedAt ? String(j.publishedAt) : null,
  })).filter((j) => j.applyUrl);
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function matchesProfile(job: BoardJob, profile: UserProfile): boolean {
  const haystack = `${job.title} ${job.description}`.toLowerCase();

  if (profile.targetTitles.length > 0) {
    const titleHit = profile.targetTitles.some((t) =>
      job.title.toLowerCase().includes(t.toLowerCase())
    );
    if (!titleHit) return false;
  }

  if (profile.excludeKeywords.some((kw) => kw && haystack.includes(kw.toLowerCase()))) {
    return false;
  }

  if (profile.remoteOnly && !job.remote) return false;

  return true;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchAtsBoardJobs(profile: UserProfile): Promise<Job[]> {
  const boards = configuredBoards();
  logger.info(`[ats-boards] Querying ${boards.length} board(s)`);

  const results = await mapWithConcurrency(boards, httpLimits.concurrency, async (b) => {
      try {
        const jobs =
          b.ats === "greenhouse" ? await fetchGreenhouse(b.token)
          : b.ats === "lever"    ? await fetchLever(b.token)
          : b.ats === "ashby"    ? await fetchAshby(b.token)
          : [];
        logger.info(`[ats-boards] ${b.ats}/${b.token}: ${jobs.length} postings`);
        return jobs;
      } catch (err) {
        logger.warn(`[ats-boards] ${b.ats}/${b.token} failed: ${String(err)}`);
      return [];
    }
  });

  const all = results.flat();
  const matched = all.filter((j) => matchesProfile(j, profile));
  logger.info(`[ats-boards] ${all.length} postings → ${matched.length} match the profile`);

  const now = new Date().toISOString();
  return matched.map((j) => ({
    id: uuidv4(),
    // The platform IS the ATS, so the orchestrator can route it straight to a
    // driver with no URL resolution.
    platform: j.ats,
    externalId: j.externalId,
    title: j.title,
    company: j.company,
    location: j.location || "Remote",
    description: j.description,
    url: j.applyUrl,
    salary: null,
    remote: j.remote,
    seniority: profile.experienceLevel,
    employmentType: j.employmentType ?? "Full-time",
    postedAt: j.postedAt ?? now,
    status: "pending" as const,
    matchScore: null,
    matchJustification: [],
    risksGaps: null,
    aiRecommendation: null,
    prediction: null,
    confidence: null,
    createdAt: now,
    updatedAt: now,
  }));
}
