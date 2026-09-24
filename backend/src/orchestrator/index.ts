import { db } from "../db/index.js";
import { matchJobWithCV, generateApplicationPack, searchJobsWithAI } from "../ai/service.js";
import { LinkedInIntegration } from "../automation/linkedin.js";
import { IndeedIntegration } from "../automation/indeed.js";
import { GreenhouseIntegration } from "../automation/greenhouse.js";
import { scrapeRemoteJobs } from "../automation/remote-scraper.js";
import { fetchAtsBoardJobs } from "../automation/ats-boards.js";
import { AtsApplicant } from "../automation/ats-driver.js";
import { resolveApplyUrl, type AtsName } from "../automation/ats.js";
import type { JobPlatform } from "../automation/platform.interface.js";
import { logger } from "../utils/logger.js";
import type { Job, UserProfile, ApplicationPack, LogLevel } from "../types/index.js";
import path from "path";
import fs from "fs";

// ─── State ────────────────────────────────────────────────────────────────────

type RunPhase = "idle" | "searching" | "matching" | "applying" | "done";

interface OrchestratorState {
  isRunning: boolean; phase: RunPhase; currentJobId: string | null;
  processed: number; applied: number; failed: number; skipped: number;
  startedAt: string | null;
}

const state: OrchestratorState = {
  isRunning: false, phase: "idle", currentJobId: null,
  processed: 0, applied: 0, failed: 0, skipped: 0, startedAt: null,
};

// ─── Platform Registry ────────────────────────────────────────────────────────

const PLATFORM_REGISTRY: Record<string, () => JobPlatform> = {
  linkedin:   () => new LinkedInIntegration(),
  indeed:     () => new IndeedIntegration(),
  greenhouse: () => new GreenhouseIntegration(),
};
function getPlatform(name: string): JobPlatform | null {
  const f = PLATFORM_REGISTRY[name]; return f ? f() : null;
}

const ATS_PLATFORMS = new Set<string>(["greenhouse", "lever", "ashby", "workable"]);

/**
 * Pick the driver that can actually submit this job.
 *
 * Jobs from the board scrapers carry a listing URL and no usable platform, so
 * we follow the listing to the real apply page and route by whichever ATS is
 * hosting it. Returns the resolved URL too — it is where the form lives, not
 * where the listing was.
 */
async function resolveDriver(
  job: Job
): Promise<{ platform: JobPlatform; applyUrl: string } | null> {
  // Hosted ATS boards all go through AtsApplicant — the per-board classes
  // handle discovery only.
  if (ATS_PLATFORMS.has(job.platform)) {
    return { platform: new AtsApplicant(job.platform as AtsName), applyUrl: job.url };
  }

  const direct = getPlatform(job.platform);
  if (direct) return { platform: direct, applyUrl: job.url };

  const { url, ats } = await resolveApplyUrl(job.url);
  if (!ats) {
    log("info", `[orchestrator] No supported ATS behind ${job.url} — leaving for review`, job.id);
    return null;
  }
  log("info", `[orchestrator] ${job.title}: resolved to ${ats} — ${url}`, job.id);
  return { platform: new AtsApplicant(ats), applyUrl: url };
}

// ─── Logging Helper ───────────────────────────────────────────────────────────

function log(level: LogLevel, message: string, jobId?: string, ctx?: Record<string, unknown>): void {
  logger[level === "success" ? "info" : level](message, ctx ?? {});
  void db.addLog(level, message, ctx, jobId);
}

// ─── CV Path ─────────────────────────────────────────────────────────────────

function findCVPath(cvFilename: string | null): string {
  if (!cvFilename) return "";
  const p = path.join("./uploads", cvFilename);
  return fs.existsSync(p) ? p : "";
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

export async function runPipeline(options: {
  platforms?: string[]; useAISearch?: boolean; maxApplications?: number;
}): Promise<void> {
  if (state.isRunning) { logger.warn("[orchestrator] Already running"); return; }

  const user = await db.getUser();
  if (!user) { log("error", "[orchestrator] No user found"); return; }

  const profile   = user.profile;
  const cvPath    = findCVPath(user.cvFilename);
  const cvText    = user.cvText ?? "";
  const maxApps   = options.maxApplications ?? profile.maxApplicationsPerDay;
  const appsToday = await db.countApplicationsToday();

  if (appsToday >= maxApps) {
    log("warn", `[orchestrator] Daily limit reached: ${appsToday}/${maxApps}`); return;
  }

  Object.assign(state, {
    isRunning: true, phase: "searching", currentJobId: null,
    processed: 0, applied: 0, failed: 0, skipped: 0,
    startedAt: new Date().toISOString(),
  });
  log("info", "[orchestrator] Pipeline started");

  try {
    const allJobs = await discoverJobs(options, profile);
    log("info", `[orchestrator] Discovered ${allJobs.length} jobs`);

    state.phase = "matching";
    const scored = await scoreJobs(allJobs, cvText, profile);

    const toApply = scored.filter(
      (j) => j.aiRecommendation === "apply" && (j.matchScore ?? 0) >= profile.minMatchScore
    );
    log("info", `[orchestrator] ${toApply.length} jobs cleared threshold (${profile.minMatchScore})`);

    if (!profile.automationMode) {
      log("info", "[orchestrator] Automation OFF — scored only, not submitted");
      state.phase = "done"; state.isRunning = false; return;
    }

    state.phase = "applying";
    const remaining = maxApps - appsToday;
    for (const job of toApply.slice(0, remaining)) {
      if (!state.isRunning) break;
      await applyToJob(job, profile, cvPath, cvText);
    }
    log("success", `[orchestrator] Done — applied:${state.applied} skipped:${state.skipped} failed:${state.failed}`);
  } catch (err) {
    log("error", `[orchestrator] Pipeline crashed: ${String(err)}`);
  } finally {
    state.phase = "done"; state.isRunning = false; state.currentJobId = null;
  }
}

// ─── Phase 1: Discover ────────────────────────────────────────────────────────

async function discoverJobs(
  options: { platforms?: string[]; useAISearch?: boolean; useRemoteScraper?: boolean }, profile: UserProfile
): Promise<Job[]> {
  const jobs: Job[] = [];

  // Hosted ATS boards — the only source whose postings carry a directly
  // submittable apply URL. Runs first because these are the jobs we can
  // actually complete end to end.
  try {
    const boardJobs = await fetchAtsBoardJobs(profile);
    for (const j of boardJobs) jobs.push(await db.upsertJob({ ...j, status: "pending" }));
    log("info", `[orchestrator] ATS boards: ${boardJobs.length} jobs`);
  } catch (err) {
    log("warn", `[orchestrator] ATS board fetch failed: ${String(err)}`);
  }

  // Remote job scraper (high-paying remote roles)
  if (options.useRemoteScraper !== false && profile.remoteOnly) {
    try {
      const remoteJobs = await scrapeRemoteJobs(profile);
      for (const j of remoteJobs) jobs.push(await db.upsertJob({ ...j, status: "pending" }));
      log("info", `[orchestrator] Remote scraper: ${remoteJobs.length} jobs`);
    } catch (err) { log("warn", `[orchestrator] Remote scraper failed: ${String(err)}`); }
  }

  if (options.useAISearch !== false) {
    try {
      const aiJobs = await searchJobsWithAI(profile);
      for (const j of aiJobs) jobs.push(await db.upsertJob({ ...j, status: "pending" }));
      log("info", `[orchestrator] AI search: ${aiJobs.length} jobs`);
    } catch (err) { log("warn", `[orchestrator] AI search failed: ${String(err)}`); }
  }

  const integrations = await db.listIntegrations();
  const enabledPlatforms = options.platforms ?? integrations.filter((i) => i.enabled).map((i) => i.platform);

  for (const name of enabledPlatforms) {
    const platform = getPlatform(name);
    if (!platform) { log("warn", `[orchestrator] Unknown platform: ${name}`); continue; }
    try {
      log("info", `[orchestrator] Searching ${name}`);
      await platform.login(profile);
      const rawJobs = await platform.searchJobs(profile);
      for (const rj of rawJobs) {
        jobs.push(await db.upsertJob({
          ...rj, status: "pending",
          matchScore: null, matchJustification: [],
          risksGaps: null, aiRecommendation: null, prediction: null, confidence: null,
        }));
      }
      log("info", `[orchestrator] ${name}: ${rawJobs.length} jobs`);
      await platform.close();
    } catch (err) {
      log("error", `[orchestrator] ${name} error: ${String(err)}`);
      await platform.close().catch(() => null);
    }
  }
  return jobs;
}

// ─── Phase 2: Score ───────────────────────────────────────────────────────────

async function scoreJobs(jobs: Job[], cvText: string, profile: UserProfile): Promise<Job[]> {
  const scored: Job[] = [];
  for (const job of jobs) {
    if (job.matchScore !== null) { scored.push(job); continue; }
    if (!cvText) {
      await db.updateJobMatch(job.id, 50, "skip", [], "No CV uploaded", "Unknown", 50);
      scored.push((await db.getJobById(job.id)) ?? job); continue;
    }
    try {
      log("info", `[orchestrator] Scoring: ${job.title} @ ${job.company}`, job.id);
      await db.updateJobStatus(job.id, "running");
      const result = await matchJobWithCV(job, cvText, profile);
      await db.updateJobMatch(job.id, result.score, result.recommendation,
        result.matchJustification, result.risksGaps, result.prediction, result.confidence);
      scored.push((await db.getJobById(job.id)) ?? job);
      log("info", `[orchestrator] Score ${result.score}/100 → ${result.recommendation}: ${job.title}`, job.id);
    } catch (err) {
      log("error", `[orchestrator] Scoring failed: ${job.title} — ${String(err)}`, job.id);
      await db.updateJobStatus(job.id, "failed");
      scored.push(job);
    }
  }
  return scored;
}

// ─── Phase 3: Apply ───────────────────────────────────────────────────────────

async function applyToJob(job: Job, profile: UserProfile, cvPath: string, cvText: string): Promise<void> {
  state.currentJobId = job.id;
  state.processed++;

  const user = await db.getUser();
  if (!user) return;

  if ((await db.countApplicationsToday()) >= profile.maxApplicationsPerDay) {
    log("warn", "[orchestrator] Daily limit reached — stopping");
    state.isRunning = false; return;
  }

  const apps = await db.listApplications(1000);
  if (apps.find((a) => a.jobId === job.id)) {
    log("info", `[orchestrator] Already applied: ${job.title}`, job.id);
    state.skipped++; return;
  }

  try {
    await db.updateJobStatus(job.id, "running");

    let coverLetter = "";
    try {
      const match = await matchJobWithCV(job, cvText, profile);
      coverLetter = match.coverLetter;
    } catch {
      coverLetter = `Dear Hiring Team,\n\nI am writing to apply for the ${job.title} position at ${job.company}.\n\nBest regards`;
    }

    let pack: ApplicationPack | null = null;
    try {
      const rawPack = await generateApplicationPack(
        { title: job.title, company: job.company, description: job.description, url: job.url },
        profile, coverLetter
      );
      pack = rawPack as unknown as ApplicationPack;
    } catch { pack = null; }

    let applied = false;
    const driver = await resolveDriver(job);
    if (driver) {
      const { platform, applyUrl } = driver;
      try {
        await platform.login(profile);
        applied = await platform.applyToJob({ ...job, url: applyUrl }, coverLetter, cvPath);
      } finally {
        await platform.close().catch(() => null);
      }
    }

    await db.updateJobStatus(job.id, applied ? "success" : "skipped");
    if (applied) { state.applied++; log("success", `[orchestrator] ✓ Applied: ${job.title} @ ${job.company}`, job.id); }
    else         { state.skipped++; log("info",    `[orchestrator] Skipped: ${job.title}`, job.id); }

    await db.createApplication({
      jobId: job.id, userId: user.id,
      jobTitle: job.title, company: job.company,
      status: applied ? "applied" : "ready_to_submit",
      matchScore: job.matchScore ?? 0,
      pack, prediction: job.prediction, confidence: job.confidence,
      appliedAt: applied ? new Date().toISOString() : null, errorMessage: null,
    });
  } catch (err) {
    const errorMessage = String(err);
    await db.updateJobStatus(job.id, "failed");
    state.failed++;
    log("error", `[orchestrator] Apply failed: ${job.title} — ${errorMessage}`, job.id);
    await db.createApplication({
      jobId: job.id, userId: user.id,
      jobTitle: job.title, company: job.company,
      status: "failed", matchScore: job.matchScore ?? 0,
      pack: null, prediction: null, confidence: null,
      appliedAt: null, errorMessage,
    });
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function retryFailed(): Promise<void> {
  const failed = await db.listJobs({ status: "failed" });
  if (failed.length === 0) { log("info", "[orchestrator] No failed jobs to retry"); return; }
  log("info", `[orchestrator] Retrying ${failed.length} failed jobs`);
  await Promise.all(failed.map((j) => db.updateJobStatus(j.id, "pending")));
  await runPipeline({ useAISearch: false });
}

export async function scoreAllPending(): Promise<void> {
  const user = await db.getUser();
  if (!user?.cvText) { log("warn", "[orchestrator] Cannot score — no CV"); return; }
  const pending = await db.listJobs({ status: "pending" });
  log("info", `[orchestrator] Scoring ${pending.length} pending jobs`);
  for (const job of pending) {
    try {
      const r = await matchJobWithCV(job, user.cvText, user.profile);
      await db.updateJobMatch(job.id, r.score, r.recommendation, r.matchJustification, r.risksGaps, r.prediction, r.confidence);
      log("info", `[orchestrator] Scored: ${job.title} → ${r.score}`, job.id);
    } catch (err) {
      log("error", `[orchestrator] Score failed: ${job.title} — ${String(err)}`, job.id);
    }
  }
}

export function getOrchestratorState(): OrchestratorState { return { ...state }; }
export function stopPipeline(): void {
  if (state.isRunning) { state.isRunning = false; log("warn", "[orchestrator] Stop requested"); }
}
