/**
 * Remote Job Scraper
 * Scrapes high-paying remote jobs from:
 * - We Work Remotely
 * - RemoteOK
 *
 * Listing URLs are resolved to a real apply URL later, in ats.ts.
 */

import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";
import { getJson } from "../utils/http.js";
import type { Job, UserProfile } from "../types/index.js";
import { v4 as uuidv4 } from "uuid";

export interface RemoteScrapedJob {
  title: string;
  company: string;
  url: string;
  salary?: string;
  salaryMin?: number;
  salaryMax?: number;
  location?: string;
  remote: boolean;
  description?: string;
  postedAt?: string;
  source: string;
}

// ─── We Work Remotely ───────────────────────────────────────────────────────

async function scrapeWeWorkRemotely(): Promise<RemoteScrapedJob[]> {
  try {
    const jobs: RemoteScrapedJob[] = [];
    const baseUrl = "https://weworkremotely.com/remote-jobs/search";

    // Search for tech roles with salary filter
    const response = await getJson<string>(`${baseUrl}?term=remote`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (response.status !== 200) {
      // WeWorkRemotely answers non-browser clients with a Cloudflare managed
      // challenge (403). Retrying harder will not help, so say so once.
      logger.warn(`[remote-scraper] We Work Remotely: HTTP ${response.status} — skipping`);
      return [];
    }

    const $ = cheerio.load(response.data);

    $("div.job").each((_i: number, el: any) => {
      const title = $(el).find("h2").text().trim();
      const company = $(el).find(".company-name").text().trim();
      const url = $(el).find("a").attr("href");
      const salary = $(el).find(".salary").text().trim();
      const description = $(el).find(".job-description").text().trim();

      if (title && url) {
        jobs.push({
          title,
          company: company || "Unknown",
          url: url.startsWith("http") ? url : `https://weworkremotely.com${url}`,
          salary: salary || undefined,
          remote: true,
          description: description || undefined,
          source: "WeWorkRemotely",
        });
      }
    });

    logger.info(`[remote-scraper] We Work Remotely: ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    logger.warn(`[remote-scraper] We Work Remotely failed: ${String(err)}`);
    return [];
  }
}

// ─── RemoteOK ───────────────────────────────────────────────────────────────

async function scrapeRemoteOK(): Promise<RemoteScrapedJob[]> {
  try {
    const jobs: RemoteScrapedJob[] = [];
    const response = await getJson<unknown>("https://remoteok.com/api?action=newest", {
      headers: { Accept: "application/json" },
    });

    const data = response.data;
    if (Array.isArray(data)) {
      for (const item of data.slice(0, 50)) {
        if (item.id === "faux") continue;

        const salaryMin = item.salary_min ? parseInt(item.salary_min, 10) : undefined;
        const salaryMax = item.salary_max ? parseInt(item.salary_max, 10) : undefined;

        // Filter for $50k+ roles (adjust as needed)
        if (salaryMin && salaryMin < 50000) continue;

        jobs.push({
          title: item.title,
          company: item.company || "Unknown",
          // Both of these stay on remoteok.com — the outbound apply link is
          // behind a gated /l/<id> redirect that bounces non-browser clients.
          // Kept for the listing itself; see ats-boards.ts for jobs we can
          // actually submit.
          url: item.apply_url || item.url,
          salary: item.salary || undefined,
          salaryMin,
          salaryMax,
          location: item.location || "Remote",
          remote: true,
          description: item.snippet || undefined,
          postedAt: item.date_posted,
          source: "RemoteOK",
        });
      }
    }

    logger.info(`[remote-scraper] RemoteOK: ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    logger.warn(`[remote-scraper] RemoteOK failed: ${String(err)}`);
    return [];
  }
}

// ─── Filter by salary & keywords ────────────────────────────────────────────

function filterHighPaying(jobs: RemoteScrapedJob[], profile: UserProfile): RemoteScrapedJob[] {
  return jobs.filter((job) => {
    // Must be in target titles
    const titleMatch = profile.targetTitles.some((t) =>
      job.title.toLowerCase().includes(t.toLowerCase())
    );
    if (!titleMatch && profile.targetTitles.length > 0) return false;

    // Must be in target industries (if specified)
    if (profile.targetIndustries.length > 0) {
      const industryMatch = profile.targetIndustries.some(
        (ind) =>
          job.title.toLowerCase().includes(ind.toLowerCase()) ||
          job.description?.toLowerCase().includes(ind.toLowerCase())
      );
      if (!industryMatch) return false;
    }

    // Exclude keywords
    if (profile.excludeKeywords.length > 0) {
      const excluded = profile.excludeKeywords.some(
        (kw) =>
          job.title.toLowerCase().includes(kw.toLowerCase()) ||
          job.description?.toLowerCase().includes(kw.toLowerCase())
      );
      if (excluded) return false;
    }

    // Filter by salary (if specified)
    if (profile.minSalary > 0 && job.salaryMin) {
      if (job.salaryMin < profile.minSalary) return false;
    }

    return true;
  });
}

// ─── Main scrape function ───────────────────────────────────────────────────

export async function scrapeRemoteJobs(profile: UserProfile): Promise<Job[]> {
  try {
    logger.info("[remote-scraper] Starting remote job scrape");

    const [weWorkRemotely, remoteOk] = await Promise.all([
      scrapeWeWorkRemotely(),
      scrapeRemoteOK(),
    ]);

    const allJobs = [...weWorkRemotely, ...remoteOk];
    logger.info(`[remote-scraper] Total jobs scraped: ${allJobs.length}`);

    const filtered = filterHighPaying(allJobs, profile);
    logger.info(`[remote-scraper] After filtering: ${filtered.length} jobs`);

    // Convert to Job format
    const convertedJobs: Job[] = filtered.map((job) => ({
      id: uuidv4(),
      platform: "remote-scraper",
      externalId: `${job.source}:${job.title}:${job.url}`,
      title: job.title,
      company: job.company,
      location: job.location || "Remote",
      description: job.description || "",
      url: job.url,
      salary: job.salary || null,
      remote: true,
      seniority: profile.experienceLevel,
      employmentType: "Full-time",
      postedAt: job.postedAt || new Date().toISOString(),
      status: "pending" as const,
      matchScore: null,
      matchJustification: [],
      risksGaps: null,
      aiRecommendation: null,
      prediction: null,
      confidence: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    return convertedJobs;
  } catch (err) {
    logger.error(`[remote-scraper] Fatal error: ${String(err)}`);
    return [];
  }
}

export default { scrapeRemoteJobs };
