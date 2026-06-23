import { BrowserBase } from "./browser.base.js";
import type { JobPlatform, RawJob } from "./platform.interface.js";
import type { Job, UserProfile } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class IndeedIntegration extends BrowserBase implements JobPlatform {
  readonly name = "indeed";
  protected platformName = "indeed";

  async login(profile: UserProfile): Promise<void> {
    const email    = profile.credentials.indeedEmail;
    const password = profile.credentials.indeedPassword;
    if (!email || !password) throw new Error("Indeed credentials not configured");

    const page = await this.launch(true);
    await page.goto("https://www.indeed.com/", { waitUntil: "domcontentloaded" });
    await this.delay(1000, 2000);

    const alreadyIn = await this.exists('[data-gnav-element-name="UserAccount"]', 3000);
    if (alreadyIn) { logger.info("[indeed] Session still valid"); return; }

    logger.info("[indeed] Logging in");
    await page.goto("https://secure.indeed.com/auth?hl=en&co=US", { waitUntil: "domcontentloaded" });
    await this.delay(1000, 2000);

    const emailInput = await page.$('#login-email-input, input[type="email"]').catch(() => null);
    if (!emailInput) throw new Error("[indeed] Could not find email input");
    await this.humanType('#login-email-input, input[type="email"]', email);
    await this.safeClick('button[data-tn-element="auth-page-email-submit-button"], button[type="submit"]');
    await this.delay(1500, 2500);

    const passInput = await page.$('#login-password-input, input[type="password"]').catch(() => null);
    if (!passInput) throw new Error("[indeed] Could not find password input");
    await this.humanType('#login-password-input, input[type="password"]', password);
    await this.safeClick('button[data-tn-element="auth-page-signin-password-form-submit-button"], button[type="submit"]');

    try {
      await page.waitForURL((url: URL) => !url.toString().includes("/auth"), { timeout: 15000 });
    } catch {
      await this.screenshot("login-timeout");
      throw new Error("[indeed] Login timed out");
    }

    await this.saveSession();
    logger.info("[indeed] Login successful");
  }

  async searchJobs(profile: UserProfile): Promise<RawJob[]> {
    const page = this.requirePage();
    const jobs: RawJob[] = [];
    const queries = profile.targetTitles.slice(0, 3);
    const location = profile.remotePreference === "Remote" ? "remote" : (profile.targetLocations[0] ?? "Remote");

    for (const query of queries) {
      try {
        const url =
          `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}` +
          (profile.remotePreference === "Remote" ? "&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11" : "") +
          `&sort=date`;

        logger.info(`[indeed] Searching: "${query}"`);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await this.delay(2000, 3500);
        await this.scrollDown(2);

        const cards = await page.$$eval(
          ".job_seen_beacon, .tapItem",
          (els: Element[]) =>
            els.slice(0, 10).map((el) => {
              const titleEl   = el.querySelector(".jobTitle a, h2.jobTitle");
              const companyEl = el.querySelector("[data-testid='company-name'], .companyName");
              const locEl     = el.querySelector("[data-testid='text-location'], .companyLocation");
              const link      = (titleEl as HTMLAnchorElement | null)?.href ?? "";
              const id        = el.getAttribute("data-jk") ?? String(Math.random());
              return {
                title:      titleEl?.textContent?.trim()   ?? "",
                company:    companyEl?.textContent?.trim() ?? "",
                location:   locEl?.textContent?.trim()     ?? "",
                url:        link.startsWith("http") ? link : `https://www.indeed.com${link}`,
                externalId: id,
              };
            })
        );

        for (const card of cards) {
          if (!card.title || !card.url) continue;
          let description = "";
          let salary: string | null = null;
          let remote = false;
          try {
            await page.goto(card.url, { waitUntil: "domcontentloaded" });
            await this.delay(1200, 2200);
            description = await page.$eval("#jobDescriptionText, .jobsearch-jobDescriptionText",
              (el: Element) => el.textContent?.trim() ?? "").catch(() => "");
            salary = await page.$eval(
              "#salaryInfoAndJobType .attribute_snippet, [data-testid='jobsearch-JobMetadataHeader-item']",
              (el: Element) => el.textContent?.trim() ?? null).catch(() => null);
            remote = card.location.toLowerCase().includes("remote") ||
              description.toLowerCase().includes("remote work") ||
              description.toLowerCase().includes("work from home");
          } catch { /* keep defaults */ }

          jobs.push({
            platform: "indeed", externalId: card.externalId,
            title: card.title, company: card.company, location: card.location,
            description, url: card.url, salary, remote,
            seniority: null, employmentType: "Full-time", postedAt: new Date().toISOString(),
          });
        }

        logger.info(`[indeed] Found ${cards.length} jobs for "${query}"`);
        await this.delay(2000, 4000);
      } catch (err) {
        logger.error(`[indeed] Search failed for "${query}"`, { err: String(err) });
        await this.screenshot("search-error");
      }
    }
    return jobs;
  }

  async applyToJob(job: Job, coverLetter: string, _cvPath: string): Promise<boolean> {
    const page = this.requirePage();
    try {
      logger.info(`[indeed] Applying: ${job.title} @ ${job.company}`);
      await page.goto(job.url, { waitUntil: "domcontentloaded" });
      await this.delay(2000, 3000);

      const applyBtn = await page.$('[data-tn-element="apply-button"], #indeedApplyButton, button[id*="apply"]').catch(() => null);
      if (!applyBtn) { logger.info(`[indeed] No Instant Apply for ${job.title}`); return false; }

      await applyBtn.click();
      await this.delay(2000, 3000);

      const applyFrame = page.frames().find(
        (f) => f.url().includes("indeedapply") || f.url().includes("apply")
      );
      const ctx = applyFrame ?? page;

      let step = 0;
      while (step < 10) {
        step++;
        await this.delay(800, 1500);

        const clArea = await ctx.$('textarea[name*="cover"], #cover_letter').catch(() => null);
        if (clArea && coverLetter) await clArea.fill(coverLetter.slice(0, 2900));

        const submitBtn = await ctx.$('button[type="submit"][data-tn-element="submit"], button:has-text("Submit")').catch(() => null);
        if (submitBtn) { await submitBtn.click(); await this.delay(2000, 3000); logger.info(`[indeed] Applied to ${job.title}`); return true; }

        const nextBtn = await ctx.$('button[data-tn-element="next"], button:has-text("Continue")').catch(() => null);
        if (nextBtn) { await nextBtn.click(); continue; }

        break;
      }
      return false;
    } catch (err) {
      logger.error(`[indeed] Apply failed: ${job.title}`, { err: String(err) });
      await this.screenshot(`apply-error-${job.id}`);
      return false;
    }
  }
}
