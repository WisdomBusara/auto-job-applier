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

  async applyToJob(job: Job, coverLetter: string, cvPath: string): Promise<boolean> {
    const page = this.requirePage();
    try {
      logger.info(`[greenhouse] Applying: ${job.title} @ ${job.company}`);
      await page.goto(job.url, { waitUntil: "domcontentloaded" });
      await this.delay(2000, 3000);

      const firstNameInput = await page.$("#first_name").catch(() => null);
      if (firstNameInput) await firstNameInput.fill("Applicant");

      const lastNameInput = await page.$("#last_name").catch(() => null);
      if (lastNameInput) await lastNameInput.fill("User");

      const emailInput = await page.$("#email").catch(() => null);
      if (emailInput) await emailInput.fill("user@example.com");

      const phoneInput = await page.$("#phone").catch(() => null);
      if (phoneInput) await phoneInput.fill("+1234567890");

      if (cvPath) {
        const resumeInput = await page.$('input[type="file"]#resume, input[type="file"][name*="resume"]').catch(() => null);
        if (resumeInput) { await resumeInput.setInputFiles(cvPath); await this.delay(1500, 2500); }
      }

      const clArea = await page.$("textarea#cover_letter, textarea[name*='cover']").catch(() => null);
      if (clArea && coverLetter) await clArea.fill(coverLetter.slice(0, 3900));

      const linkedinInput = await page.$('input[id*="linkedin"], input[name*="linkedin"]').catch(() => null);
      if (linkedinInput) await linkedinInput.fill("https://linkedin.com/in/applicant");

      // Fill text inputs (excluding known fields)
      const textQs = await page.$$("input[type='text']:not([id='first_name']):not([id='last_name']):not([id='email']):not([id='phone'])");
      for (const inp of textQs) {
        const v = await inp.inputValue().catch(() => "");
        if (!v) await inp.fill("Yes");
      }

      // Pick first valid option in selects
      const selects = await page.$$("select");
      for (const sel of selects) {
        const options = await sel.$$eval(
          "option",
          (opts: HTMLOptionElement[]) => opts.map((o) => o.value).filter((v) => v !== "")
        );
        if (options[0]) await sel.selectOption(options[0]);
      }

      const submitBtn = await page.$('input[type="submit"]#submit_app, button[type="submit"]').catch(() => null);
      if (!submitBtn) { logger.warn(`[greenhouse] No submit button for ${job.title}`); return false; }

      await submitBtn.click();
      await this.delay(3000, 5000);

      const success = await this.exists(".success, .confirmation, [class*='success']", 5000);
      logger.info(`[greenhouse] Applied to ${job.title} — success=${success}`);
      return success;
    } catch (err) {
      logger.error(`[greenhouse] Apply failed: ${job.title}`, { err: String(err) });
      await this.screenshot(`apply-error-${job.id}`);
      return false;
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}
