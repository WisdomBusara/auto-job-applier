/**
 * Remote Job Scraper
 * Scrapes high-paying remote jobs from:
 * - We Work Remotely
 * - Remote.co
 * - RemoteOK
 * - GitHub Jobs API
 * - LinkedIn (via Playwright if logged in)
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";
import type { Job, UserProfile } from "../types/index.js";
import { v4 as uuidv4 } from "uuid";

const HTTP = axios.create({
  timeout: 15_000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Accept: "text/html,application/json",
  },
});

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
    const response = await HTTP.get(baseUrl, {
      params: { term: "remote" },
    });

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
    const response = await HTTP.get("https://remoteok.com/api", {
      params: { action: "newest" },
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
          url: item.url,
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

// ─── GitHub Jobs API ────────────────────────────────────────────────────────

async function scrapeGitHubJobs(): Promise<RemoteScrapedJob[]> {
  try {
    const jobs: RemoteScrapedJob[] = [];
    const response = await HTTP.get("https://jobs.github.com/positions.json", {
      params: { location: "remote" },
    });

    const data = response.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        jobs.push({
          title: item.title,
          company: item.company,
          url: item.url,
          location: item.location || "Remote",
          remote: true,
          description: item.description?.substring(0, 500) || undefined,
          postedAt: item.created_at,
          source: "GitHub Jobs",
        });
      }
    }

    logger.info(`[remote-scraper] GitHub Jobs: ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    logger.warn(`[remote-scraper] GitHub Jobs failed: ${String(err)}`);
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

    const [weWorkRemotely, remoteOk, gitHubJobs] = await Promise.all([
      scrapeWeWorkRemotely(),
      scrapeRemoteOK(),
      scrapeGitHubJobs(),
    ]);

    const allJobs = [...weWorkRemotely, ...remoteOk, ...gitHubJobs];
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
