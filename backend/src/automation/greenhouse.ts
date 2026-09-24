import { BrowserBase } from "./browser.base.js";
import type { JobPlatform, RawJob } from "./platform.interface.js";
import type { Job, UserProfile } from "../types/index.js";
import { logger } from "../utils/logger.js";

const GREENHOUSE_BOARDS: Array<{ company: string; boardToken: string }> = [
  { company: "Anthropic",   boardToken: "anthropic" },
  { company: "OpenAI",      boardToken: "openai" },
  { company: "Retool",      boardToken: "retool" },
  { company: "Vercel",      boardToken: "vercel" },
  { company: "Figma",       boardToken: "figma" },
  { company: "Notion",      boardToken: "notion" },
  { company: "Linear",      boardToken: "linear" },
  { company: "Airtable",    boardToken: "airtable" },
  { company: "ElevenLabs",  boardToken: "elevenlabs" },
  { company: "Mistral AI",  boardToken: "mistral" },
];

export class GreenhouseIntegration extends BrowserBase implements JobPlatform {
  readonly name = "greenhouse";
  protected platformName = "greenhouse";

  async login(_profile: UserProfile): Promise<void> {
    await this.launch(true);
    logger.info("[greenhouse] Browser ready (no login required for search)");
  }

  async searchJobs(profile: UserProfile): Promise<RawJob[]> {
    const page = this.requirePage();
    const jobs: RawJob[] = [];
    const titleKeywords = profile.targetTitles.map((t) => t.toLowerCase());

    for (const board of GREENHOUSE_BOARDS) {
      try {
        const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${board.boardToken}/jobs?content=true`;
        await page.goto(apiUrl, { waitUntil: "domcontentloaded" });
        await this.delay(500, 1000);

        const bodyText = await page.$eval("body, pre", (el: Element) => el.textContent ?? "").catch(() => "");
        if (!bodyText) continue;

        let data: { jobs?: Array<Record<string, unknown>> };
        try { data = JSON.parse(bodyText) as { jobs?: Array<Record<string, unknown>> }; }
        catch { continue; }

        if (!Array.isArray(data.jobs)) continue;

        for (const j of data.jobs) {
          const title = String(j.title ?? "");
          const id    = String(j.id ?? Math.random());
          const applyUrl  = String(j.absolute_url ?? `https://boards.greenhouse.io/${board.boardToken}/jobs/${id}`);
          const description = this.stripHtml(String((j.content as string | undefined) ?? ""));
          const locObj  = j.location as Record<string, unknown> | undefined;
          const location = (locObj?.name as string | undefined) ?? "";
          const remote  = location.toLowerCase().includes("remote") || description.toLowerCase().includes("remote");

          const titleLower = title.toLowerCase();
          const matches = titleKeywords.some((kw) =>
            titleLower.includes(kw) || kw.split(" ").some((w) => w.length > 3 && titleLower.includes(w))
          );
          if (!matches) continue;

          const excludeMatch = profile.excludeKeywords.some((kw) =>
            titleLower.includes(kw.toLowerCase())
          );
          if (excludeMatch) continue;

          jobs.push({
            platform: "greenhouse",
            externalId: `${board.boardToken}-${id}`,
            title, company: board.company, location,
            description: description.slice(0, 3000),
            url: applyUrl, salary: null, remote,
            seniority: null, employmentType: "Full-time",
            postedAt: (j.updated_at as string | undefined) ?? new Date().toISOString(),
          });
        }

        logger.info(`[greenhouse] ${board.company}: scanned`);
        await this.delay(300, 700);
      } catch (err) {
        logger.debug(`[greenhouse] Failed to scan ${board.company}`, { err: String(err) });
      }
    }

    logger.info(`[greenhouse] Total found: ${jobs.length} jobs`);
    return jobs;
  }

  /**
   * Discovery only. Submitting is handled by AtsApplicant, which fills the
   * Greenhouse form from the user profile and refuses to submit an incomplete
   * one — this class used to post a placeholder identity.
   */
  async applyToJob(job: Job, _coverLetter: string, _cvPath: string): Promise<boolean> {
    logger.warn(
      `[greenhouse] applyToJob is not used — route ${job.title} through AtsApplicant`
    );
    return false;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}
