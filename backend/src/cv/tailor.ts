/**
 * cv/tailor.ts
 *
 * Produces the CV file that actually gets uploaded to an application.
 *
 * Until now the pipeline generated "resume edits" as advice text and then
 * attached the candidate's unmodified base CV, so every application received
 * the same document. This renders a real .docx per job from the tailored
 * content and hands back its path.
 *
 * Layout is deliberately plain — single column, no tables, no text boxes,
 * standard headings. ATS parsers mangle anything more decorative.
 */

import fs from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from "docx";
import { generateTailoredCv } from "../ai/service.js";
import { logger } from "../utils/logger.js";
import type { Job, UserProfile, TailoredCv } from "../types/index.js";

const TAILORED_DIR = "./data/tailored";

/** Filesystem-safe fragment for a filename. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function renderCvDocx(cv: TailoredCv): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: cv.fullName, bold: true, size: 32 })],
    })
  );

  if (cv.headline) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: cv.headline, size: 24 })],
      })
    );
  }

  if (cv.contact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: cv.contact, size: 20 })],
      })
    );
  }

  if (cv.summary) {
    children.push(new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text: cv.summary, spacing: { after: 160 } }));
  }

  if (cv.skills.length > 0) {
    children.push(new Paragraph({ text: "Skills", heading: HeadingLevel.HEADING_2 }));
    children.push(
      new Paragraph({ text: cv.skills.join(" · "), spacing: { after: 160 } })
    );
  }

  if (cv.experience.length > 0) {
    children.push(new Paragraph({ text: "Experience", heading: HeadingLevel.HEADING_2 }));
    for (const role of cv.experience) {
      const heading = [role.role, role.company].filter(Boolean).join(" — ");
      children.push(
        new Paragraph({
          spacing: { before: 160 },
          children: [new TextRun({ text: heading, bold: true })],
        })
      );
      if (role.dates) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: role.dates, italics: true, size: 20 })] })
        );
      }
      for (const bullet of role.bullets) {
        children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
      }
    }
  }

  if (cv.education.length > 0) {
    children.push(
      new Paragraph({ text: "Education", heading: HeadingLevel.HEADING_2, spacing: { before: 200 } })
    );
    for (const line of cv.education) {
      children.push(new Paragraph({ text: line }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export interface TailorResult {
  /** Path to upload. The original CV when tailoring was not possible. */
  cvPath: string;
  tailored: boolean;
  changeNotes: string[];
}

/**
 * Build a job-specific CV, falling back to the original file whenever the
 * tailored version cannot be produced or trusted. Submitting the base CV is a
 * worse application; submitting a fabricated one is a worse problem.
 */
export async function tailorCvForJob(
  job: Job,
  cvText: string,
  baseCvPath: string,
  profile: UserProfile
): Promise<TailorResult> {
  const fallback: TailorResult = { cvPath: baseCvPath, tailored: false, changeNotes: [] };

  if (!cvText.trim()) return fallback;

  let cv: TailoredCv | null;
  try {
    cv = await generateTailoredCv(cvText, job, profile);
  } catch (err) {
    logger.warn(`[cv] Tailoring failed for ${job.title}: ${String(err)}`);
    return fallback;
  }
  if (!cv) return fallback;

  try {
    fs.mkdirSync(TAILORED_DIR, { recursive: true });
    const filename = `cv-${slug(cv.fullName || profile.fullName)}-${slug(job.company)}-${job.id.slice(0, 8)}.docx`;
    const outPath = path.join(TAILORED_DIR, filename);

    const buffer = await renderCvDocx(cv);
    fs.writeFileSync(outPath, buffer);

    logger.info(`[cv] Tailored CV written: ${outPath}`);
    return { cvPath: outPath, tailored: true, changeNotes: cv.changeNotes };
  } catch (err) {
    logger.warn(`[cv] Could not write tailored CV for ${job.title}: ${String(err)}`);
    return fallback;
  }
}
