/**
 * ats-driver.ts
 *
 * One driver for every hosted ATS we support. The forms differ in markup but
 * ask the same things, so fields are matched by their visible label first and
 * by known selectors second — labels survive redesigns that break IDs.
 *
 * Two rules keep this safe to run unattended:
 *   1. Every value comes from the user profile. Nothing is invented.
 *   2. If a required field is still empty after filling, we do not submit.
 *      The job is left for review instead of sending a half-answered form.
 *
 * Set ATS_DRY_RUN=1 to fill and screenshot without ever clicking submit.
 */

import fs from "fs";
import { BrowserBase } from "./browser.base.js";
import type { JobPlatform, RawJob } from "./platform.interface.js";
import type { Job, UserProfile } from "../types/index.js";
import { answerScreeningQuestions } from "../ai/service.js";
import { logger } from "../utils/logger.js";
import type { AtsName } from "./ats.js";

type FieldKey =
  | "firstName" | "lastName" | "fullName" | "email" | "phone"
  | "linkedin" | "github" | "portfolio" | "location" | "coverLetter";

/** Visible-label patterns → which profile value belongs in the field. */
const LABEL_MATCHERS: Array<{ key: FieldKey; re: RegExp }> = [
  { key: "firstName",   re: /^\s*first\s*name/i },
  { key: "lastName",    re: /^\s*(last\s*name|surname)/i },
  { key: "fullName",    re: /^\s*(full\s*)?name\s*\*?\s*$/i },
  { key: "email",       re: /e-?mail/i },
  { key: "phone",       re: /phone|mobile|telephone/i },
  { key: "linkedin",    re: /linked\s*-?in/i },
  { key: "github",      re: /git\s*hub/i },
  { key: "portfolio",   re: /portfolio|website|personal\s*site/i },
  { key: "location",    re: /location|city|where are you/i },
  { key: "coverLetter", re: /cover\s*letter/i },
];

function valueFor(key: FieldKey, p: UserProfile, coverLetter: string): string {
  const parts = (p.fullName ?? "").trim().split(/\s+/);
  switch (key) {
    case "firstName":   return parts[0] ?? "";
    case "lastName":    return parts.length > 1 ? parts.slice(1).join(" ") : "";
    case "fullName":    return p.fullName ?? "";
    case "email":       return p.email ?? "";
    case "phone":       return p.phone ?? "";
    case "linkedin":    return p.links?.linkedin ?? "";
    case "github":      return p.links?.github ?? "";
    case "portfolio":   return p.links?.portfolio ?? "";
    case "location":    return p.targetLocations?.[0] ?? "Remote";
    case "coverLetter": return coverLetter;
  }
}

const SUBMIT_SELECTORS: Record<AtsName, string> = {
  greenhouse: 'input[type="submit"]#submit_app, button[type="submit"]',
  lever:      'button[type="submit"], input[type="submit"]',
  ashby:      'button[type="submit"]',
  workable:   'button[data-ui="submit-application"], button[type="submit"]',
};

const SUCCESS_SELECTOR =
  '.application-confirmation, [class*="success"], [class*="confirmation"]';

export class AtsApplicant extends BrowserBase implements JobPlatform {
  readonly name: string;
  private profile: UserProfile | null = null;
  private readonly ats: AtsName;

  constructor(ats: AtsName) {
    super();
    this.ats = ats;
    this.name = ats;
    this.platformName = ats;
  }

  async login(profile: UserProfile): Promise<void> {
    this.profile = profile;
    await this.launch(true);
    logger.info(`[${this.ats}] Browser ready (hosted ATS — no login)`);
  }

  /** This driver only submits; discovery is handled by the scrapers. */
  async searchJobs(_profile: UserProfile): Promise<RawJob[]> {
    return [];
  }

  async applyToJob(job: Job, coverLetter: string, cvPath: string): Promise<boolean> {
    const page = this.requirePage();
    const profile = this.profile;
    if (!profile) throw new Error(`[${this.ats}] login() must run before applyToJob()`);

    try {
      logger.info(`[${this.ats}] Applying: ${job.title} @ ${job.company} — ${job.url}`);
      await page.goto(job.url, { waitUntil: "domcontentloaded" });
      await this.delay(1500, 2800);

      // Some boards keep the form behind an "Apply for this job" toggle.
      const applyToggle = await page
        .$('a:has-text("Apply for this job"), button:has-text("Apply for this job")')
        .catch(() => null);
      if (applyToggle) {
        await applyToggle.click().catch(() => null);
        await this.delay(1000, 2000);
      }

      await this.fillLabelledFields(profile, coverLetter);
      await this.attachResume(cvPath);
      await this.answerCustom(job, profile);

      const unanswered = await this.unansweredRequired();
      if (unanswered.length > 0) {
        logger.warn(
          `[${this.ats}] Not submitting ${job.title} — ${unanswered.length} required field(s) unanswered: ${unanswered.join(", ")}`
        );
        await this.screenshot(`needs-review-${job.id}`);
        return false;
      }

      if (process.env.ATS_DRY_RUN === "1") {
        logger.info(`[${this.ats}] DRY RUN — form complete, not submitting: ${job.title}`);
        await this.screenshot(`dry-run-${job.id}`);
        return false;
      }

      const submitBtn = await page.$(SUBMIT_SELECTORS[this.ats]).catch(() => null);
      if (!submitBtn) {
        logger.warn(`[${this.ats}] No submit button found for ${job.title}`);
        await this.screenshot(`no-submit-${job.id}`);
        return false;
      }

      await submitBtn.click();
      await this.delay(3000, 5000);

      const ok = await this.exists(SUCCESS_SELECTOR, 8000);
      if (!ok) await this.screenshot(`unconfirmed-${job.id}`);
      logger.info(`[${this.ats}] ${job.title} — confirmed=${ok}`);
      return ok;
    } catch (err) {
      logger.error(`[${this.ats}] Apply failed: ${job.title}`, { err: String(err) });
      await this.screenshot(`apply-error-${job.id}`);
      return false;
    }
  }

  /** Fill empty inputs whose visible label matches a known profile field. */
  private async fillLabelledFields(profile: UserProfile, coverLetter: string): Promise<void> {
    const page = this.requirePage();
    const fields = await page.$$(
      "input[type='text'], input[type='email'], input[type='tel'], input[type='url'], textarea"
    );

    for (const field of fields) {
      try {
        const existing = await field.inputValue().catch(() => "");
        if (existing) continue;

        const label = await field.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          if (input.id) {
            const byFor = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (byFor?.textContent) return byFor.textContent;
          }
          const wrapping = input.closest("label");
          if (wrapping?.textContent) return wrapping.textContent;
          return (
            input.getAttribute("aria-label") ??
            input.getAttribute("placeholder") ??
            input.getAttribute("name") ??
            ""
          );
        });

        const match = LABEL_MATCHERS.find((m) => m.re.test(label));
        if (!match) continue;

        const value = valueFor(match.key, profile, coverLetter);
        if (!value) continue;

        await field.fill(value.slice(0, match.key === "coverLetter" ? 4000 : 200));
        await this.delay(150, 400);
      } catch {
        // Field detached or not fillable — move on.
      }
    }
  }

  private async attachResume(cvPath: string): Promise<void> {
    if (!cvPath || !fs.existsSync(cvPath)) {
      logger.warn(`[${this.ats}] No CV file at "${cvPath}" — resume not attached`);
      return;
    }
    const page = this.requirePage();
    const input = await page
      .$('input[type="file"][name*="resume"], input[type="file"][id*="resume"], input[type="file"]')
      .catch(() => null);
    if (!input) {
      logger.warn(`[${this.ats}] No file input found for resume`);
      return;
    }
    await input.setInputFiles(cvPath);
    await this.delay(1500, 2800);
  }

  /**
   * Company-specific screening questions ("Why this company?", "Years with
   * Kubernetes?"). Answers are drafted from the profile by the AI service;
   * anything it declines to answer stays empty and trips the submit gate.
   */
  private async answerCustom(job: Job, profile: UserProfile): Promise<void> {
    const page = this.requirePage();

    const pending = await page.$$eval(
      "textarea, input[type='text']",
      (els: Element[]) =>
        els
          .map((el) => {
            const input = el as HTMLInputElement;
            if (input.value) return null;
            let label = "";
            if (input.id) {
              label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? "";
            }
            if (!label) label = input.closest("label")?.textContent ?? "";
            if (!label) {
              label = input.getAttribute("aria-label") ?? input.getAttribute("placeholder") ?? "";
            }
            label = label.replace(/\s+/g, " ").trim();
            if (!label || label.length < 8) return null;
            return { id: input.id, label };
          })
          .filter((q): q is { id: string; label: string } => q !== null)
    );

    if (pending.length === 0) return;

    let answers: Record<string, string>;
    try {
      answers = await answerScreeningQuestions(
        pending.map((q) => q.label),
        { title: job.title, company: job.company, description: job.description },
        profile
      );
    } catch (err) {
      logger.warn(`[${this.ats}] Screening-question answering failed: ${String(err)}`);
      return;
    }

    for (const q of pending) {
      const answer = answers[q.label];
      if (!answer || !q.id) continue;
      try {
        const el = await page.$(`#${CSS.escape(q.id)}`);
        if (el) {
          await el.fill(answer.slice(0, 2000));
          await this.delay(200, 500);
        }
      } catch {
        // Skip — the gate will catch it if it was required.
      }
    }
  }

  /**
   * Required fields still empty after every fill pass.
   *
   * The `required` attribute alone is not enough: Greenhouse (and Ashby) mark
   * required fields with an asterisk in the label and enforce it in JS, so a
   * form full of empty mandatory questions has zero `[required]` inputs. We
   * treat an asterisk or aria-required as equally binding.
   */
  private async unansweredRequired(): Promise<string[]> {
    const page = this.requirePage();
    return page.$$eval(
      "input, textarea, select",
      (els: Element[]) =>
        els
          .map((el) => {
            const input = el as HTMLInputElement;
            if (input.type === "hidden" || input.disabled) return null;

            const labelText = (() => {
              if (input.id) {
                const byFor = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
                if (byFor?.textContent) return byFor.textContent;
              }
              return (
                input.closest("label")?.textContent ??
                input.getAttribute("aria-label") ??
                input.getAttribute("name") ??
                input.id ??
                ""
              );
            })().replace(/\s+/g, " ").trim();

            const isRequired =
              input.required ||
              input.getAttribute("aria-required") === "true" ||
              /\*\s*$/.test(labelText);
            if (!isRequired) return null;

            if (input.type === "file") {
              return input.files && input.files.length > 0 ? null : "resume";
            }
            if (input.type === "checkbox" || input.type === "radio") {
              const name = input.name;
              if (!name) return input.checked ? null : labelText;
              const group = document.querySelectorAll<HTMLInputElement>(
                `input[name="${CSS.escape(name)}"]`
              );
              return Array.from(group).some((g) => g.checked) ? null : labelText;
            }
            if (input.value && input.value.trim()) return null;

            return labelText.slice(0, 60) || "unnamed";
          })
          .filter((s): s is string => Boolean(s))
          // One asterisked question can own several inputs; report each once.
          .filter((s, i, arr) => arr.indexOf(s) === i)
    );
  }
}
