import fs from "fs";
import { BrowserBase } from "./browser.base.js";
import type { JobPlatform, RawJob } from "./platform.interface.js";
import type { Job, UserProfile } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class LinkedInIntegration extends BrowserBase implements JobPlatform {
  readonly name = "linkedin";
  protected platformName = "linkedin";

  async login(profile: UserProfile): Promise<void> {
    const email = profile.credentials.linkedinEmail;
    const password = profile.credentials.linkedinPassword;
    if (!email || !password) throw new Error("LinkedIn credentials not configured in user profile");

    const page = await this.launch(true);
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await this.delay(1000, 2000);

    if (!page.url().includes("/login") && !page.url().includes("/uas/")) {
      logger.info("[linkedin] Session still valid — skipping login");
      return;
    }

    logger.info("[linkedin] Starting fresh login");
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
    await this.delay(800, 1500);
    await this.humanType("#username", email);
    await this.humanType("#password", password);
    await this.delay(400, 800);
    await page.click('[data-litms-control-urn="login-submit"], button[type="submit"]');

    try {
      await page.waitForURL(
        (url: URL) => url.toString().includes("/feed") || url.toString().includes("/checkpoint"),
        { timeout: 15000 }
      );
    } catch {
      await this.screenshot("login-timeout");
      throw new Error("[linkedin] Login timed out — check credentials");
    }

    if (page.url().includes("/checkpoint")) {
      await this.screenshot("checkpoint");
      this.clearSession();
      throw new Error("[linkedin] Security checkpoint hit — manual login required");
    }

    await this.saveSession();
    logger.info("[linkedin] Login successful");
  }

  async searchJobs(profile: UserProfile): Promise<RawJob[]> {
    const page = this.requirePage();
    const jobs: RawJob[] = [];
    const queries = profile.targetTitles.slice(0, 3);
    const location = profile.targetLocations[0] ?? "Remote";

    for (const query of queries) {
      try {
        const remoteFilter  = profile.remotePreference === "Remote" ? "&f_WT=2" : "";
        const easyFilter    = profile.preferEasyApply ? "&f_AL=true" : "";
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}${remoteFilter}${easyFilter}&sortBy=DD`;

        logger.info(`[linkedin] Searching: "${query}" in ${location}`);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await this.delay(2000, 3500);
        await this.scrollDown(2);

        const cards = await page.$$eval(
          ".jobs-search__results-list li, .scaffold-layout__list-item",
          (els: Element[]) =>
            els.slice(0, 12).map((el) => {
              const titleEl   = el.querySelector(".base-search-card__title, .job-card-list__title");
              const companyEl = el.querySelector(".base-search-card__subtitle, .job-card-container__company-name");
              const locEl     = el.querySelector(".job-search-card__location, .job-card-container__metadata-item");
              const linkEl    = el.querySelector("a.base-card__full-link, a.job-card-list__title") as HTMLAnchorElement | null;
              const urnAttr   = el.getAttribute("data-entity-urn") ?? "";
              return {
                title:      titleEl?.textContent?.trim()   ?? "",
                company:    companyEl?.textContent?.trim() ?? "",
                location:   locEl?.textContent?.trim()     ?? "",
                url:        linkEl?.href                   ?? "",
                externalId: urnAttr.split(":").pop()       ?? String(Math.random()),
              };
            })
        );

        for (const card of cards) {
          if (!card.title || !card.url) continue;
          let description = "";
          let salary: string | null = null;
          let remote = false;
          let seniority: string | null = null;

          try {
            await page.goto(card.url, { waitUntil: "domcontentloaded" });
            await this.delay(1200, 2500);
            description = await page.$eval(".jobs-description__content, .description__text",
              (el: Element) => el.textContent?.trim() ?? "").catch(() => "");
            salary = await page.$eval(".compensation__salary, .salary",
              (el: Element) => el.textContent?.trim() ?? null).catch(() => null);
            const badge = await page.$eval(".jobs-unified-top-card__workplace-type",
              (el: Element) => el.textContent?.trim() ?? "").catch(() => "");
            remote = badge.toLowerCase().includes("remote") || card.location.toLowerCase().includes("remote");
            seniority = await page.$eval(".job-criteria__item:first-child .job-criteria__text",
              (el: Element) => el.textContent?.trim() ?? null).catch(() => null);
          } catch { /* keep defaults */ }

          jobs.push({
            platform: "linkedin", externalId: card.externalId,
            title: card.title, company: card.company, location: card.location,
            description, url: card.url, salary, remote, seniority,
            employmentType: "Full-time", postedAt: new Date().toISOString(),
          });
        }

        logger.info(`[linkedin] Found ${cards.length} jobs for "${query}"`);
        await this.delay(1500, 3000);
      } catch (err) {
        logger.error(`[linkedin] Search failed for "${query}"`, { err: String(err) });
        await this.screenshot(`search-error`);
      }
    }
    return jobs;
  }

  async applyToJob(job: Job, coverLetter: string, cvPath: string): Promise<boolean> {
    const page = this.requirePage();
    try {
      logger.info(`[linkedin] Applying to: ${job.title} @ ${job.company}`);
      await page.goto(job.url, { waitUntil: "domcontentloaded" });
      await this.delay(2000, 3000);

      const easyApplyBtn = await page.$('[aria-label*="Easy Apply"], .jobs-apply-button').catch(() => null);
      if (!easyApplyBtn) { logger.info(`[linkedin] No Easy Apply for ${job.title}`); return false; }
      await easyApplyBtn.click();
      await this.delay(1500, 2500);

      let step = 0;
      while (step < 12) {
        step++;
        await this.delay(800, 1500);

        if (cvPath && fs.existsSync(cvPath)) {
          const fileInput = await page.$('input[type="file"]').catch(() => null);
          if (fileInput) { await fileInput.setInputFiles(cvPath); await this.delay(1000, 2000); }
        }

        const phoneInputs = await page.$$('input[id*="phoneNumber"], input[name*="phone"]');
        for (const inp of phoneInputs) {
          const v = await inp.inputValue().catch(() => "");
          if (!v) { await inp.fill("+1234567890"); await this.delay(200, 400); }
        }

        const clArea = await page.$('textarea[id*="coverLetter"], textarea[name*="cover"]').catch(() => null);
        if (clArea && coverLetter) await clArea.fill(coverLetter.slice(0, 2900));

        const yesRadios = await page.$$('input[type="radio"][value="Yes"], input[type="radio"][value="yes"]');
        for (const r of yesRadios) await r.check().catch(() => null);

        const numericInputs = await page.$$('input[type="number"]');
        for (const inp of numericInputs) {
          const v = await inp.inputValue().catch(() => "");
          if (!v) await inp.fill("1");
        }

        const submitBtn = await page.$('[aria-label="Submit application"]').catch(() => null);
        if (submitBtn) {
          await submitBtn.click();
          await this.delay(2000, 3000);
          const dismissBtn = await page.$('[aria-label="Dismiss"]').catch(() => null);
          if (dismissBtn) await dismissBtn.click();
          logger.info(`[linkedin] Applied to ${job.title} @ ${job.company}`);
          return true;
        }

        const reviewBtn = await page.$('[aria-label="Review your application"]').catch(() => null);
        if (reviewBtn) { await reviewBtn.click(); continue; }

        const nextBtn = await page.$('[aria-label="Continue to next step"]').catch(() => null);
        if (nextBtn) { await nextBtn.click(); continue; }

        logger.warn(`[linkedin] No nav button on step ${step}`);
        break;
      }
      return false;
    } catch (err) {
      logger.error(`[linkedin] Apply failed for ${job.title}`, { err: String(err) });
      await this.screenshot(`apply-error-${job.id}`);
      return false;
    }
  }
}
