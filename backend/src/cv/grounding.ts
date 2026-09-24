/**
 * cv/grounding.ts
 *
 * Checks a tailored CV against the CV the user actually uploaded.
 *
 * generateTailoredCv instructs the model not to invent employers, dates or
 * metrics. An instruction is not an enforcement mechanism: models embellish,
 * and a hostile job posting can ask them to. Since the result is submitted to
 * employers under the user's name, the claim is verified rather than trusted.
 *
 * This is deliberately model-free. It compares strings, so it cannot be
 * persuaded, costs nothing, and behaves identically on every run.
 *
 * The check is asymmetric on purpose. Dropping material is fine — tailoring is
 * mostly selection. Adding a number or an employer the source does not contain
 * is the failure mode that matters, so that is what it looks for.
 *
 * Inspired by the Factual Grounding Audit in MadsLorentzen/ai-job-search (MIT).
 */

import type { TailoredCv } from "../types/index.js";

export type GroundingSeverity = "error" | "warning";

export interface GroundingFinding {
  severity: GroundingSeverity;
  kind: "employer" | "role" | "metric";
  claim: string;
  where: string;
}

/** Lowercase, collapse whitespace, and normalise punctuation that varies. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Numbers worth checking: percentages, money, multipliers, and counts.
 *
 * Bare small integers are skipped — "led 3 engineers" is a claim, but "3" also
 * appears in almost any source text by coincidence, so flagging it produces
 * noise without catching fabrication.
 */
function extractMetrics(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\d[\d,.]*\s*%/g,                       // 40%, 12.5 %
    /[$£€]\s?\d[\d,.]*\s*[kmb]?\b/gi,       // $1.2M, £50k
    /\b\d[\d,.]*\s*[kmb]\b/gi,              // 250k, 1.2M
    /\b\d[\d,.]*\s*x\b/gi,                  // 3x
    /\b\d{2,}[\d,.]*\b/g,                   // any number with 2+ digits
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.add(m[0]);
  }
  return [...out];
}

/** Digits only, so "1,200" and "1200" compare equal. */
function digitsOf(s: string): string {
  return s.replace(/[^\d]/g, "");
}

function sourceHasMetric(metric: string, sourceDigits: Set<string>): boolean {
  const d = digitsOf(metric);
  if (!d) return true;
  if (sourceDigits.has(d)) return true;
  // "1.2M" in the draft against "1,200,000" in the source, and the reverse.
  for (const known of sourceDigits) {
    if (known.startsWith(d) || d.startsWith(known)) return true;
  }
  return false;
}

export function auditTailoredCv(cv: TailoredCv, sourceCvText: string): GroundingFinding[] {
  const findings: GroundingFinding[] = [];
  const source = normalise(sourceCvText);
  if (!source) return findings;

  const sourceDigits = new Set(extractMetrics(sourceCvText).map(digitsOf).filter(Boolean));
  // Years and other bare numbers in the source count as known values too.
  for (const m of sourceCvText.matchAll(/\d[\d,.]*/g)) {
    const d = digitsOf(m[0]);
    if (d) sourceDigits.add(d);
  }

  for (const role of cv.experience) {
    const where = [role.role, role.company].filter(Boolean).join(" — ") || "(unnamed role)";

    // Employers are proper nouns. Tailoring may drop one; it may not add one.
    if (role.company && !source.includes(normalise(role.company))) {
      findings.push({
        severity: "error",
        kind: "employer",
        claim: role.company,
        where,
      });
    }

    // Titles get legitimately reworded, so a miss is worth surfacing but not
    // worth discarding the document over.
    if (role.role && !source.includes(normalise(role.role))) {
      findings.push({ severity: "warning", kind: "role", claim: role.role, where });
    }

    for (const bullet of role.bullets) {
      for (const metric of extractMetrics(bullet)) {
        if (!sourceHasMetric(metric, sourceDigits)) {
          findings.push({
            severity: "error",
            kind: "metric",
            claim: metric,
            where: `${where}: "${bullet.slice(0, 80)}"`,
          });
        }
      }
    }
  }

  for (const metric of extractMetrics(cv.summary)) {
    if (!sourceHasMetric(metric, sourceDigits)) {
      findings.push({
        severity: "error",
        kind: "metric",
        claim: metric,
        where: "summary",
      });
    }
  }

  return findings;
}

/**
 * Remove what the audit could not ground, rather than discarding the whole
 * document: a CV with one over-eager bullet dropped is still a better
 * application than the untailored original.
 *
 * An ungrounded employer is not repairable this way — it means the model
 * invented a role — so the caller is told to fall back instead.
 */
export function pruneUngrounded(
  cv: TailoredCv,
  findings: GroundingFinding[]
): { cv: TailoredCv; repairable: boolean } {
  if (findings.some((f) => f.kind === "employer")) {
    return { cv, repairable: false };
  }

  const badMetrics = findings
    .filter((f) => f.severity === "error" && f.kind === "metric")
    .map((f) => f.claim);
  if (badMetrics.length === 0) return { cv, repairable: true };

  const drop = (text: string): boolean =>
    badMetrics.some((m) => text.includes(m));

  const pruned: TailoredCv = {
    ...cv,
    summary: drop(cv.summary) ? "" : cv.summary,
    experience: cv.experience.map((r) => ({
      ...r,
      bullets: r.bullets.filter((b) => !drop(b)),
    })),
  };

  return { cv: pruned, repairable: true };
}
