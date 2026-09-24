/**
 * screening.ts
 *
 * Answers the standard questions application forms ask, from the profile
 * alone. No model involved.
 *
 * This exists for correctness before cost. "Do you require visa sponsorship?"
 * and "Are you authorised to work here?" are legal attestations on a document
 * submitted under the candidate's name; they must come from a field the user
 * set, not from a model's reading of a CV. A deterministic answer is also
 * stable across applications, which a generated one is not.
 *
 * Questions this cannot ground return null, and the caller falls back to the
 * AI drafter — or, failing that, to the submit gate, which stops the
 * application for review.
 */

import type { Job, UserProfile, ScreeningAnswers } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Questions we refuse to answer automatically under any circumstances.
 *
 * Demographic self-identification is voluntary and personal, and criminal
 * history and similar disclosures carry consequences the user must own. These
 * are left blank so the gate stops the application and the user answers them.
 */
const NEVER_AUTO_ANSWER =
  /gender|\brace\b|ethnic|hispanic|latino|veteran|disabilit|sexual orientation|pronoun|transgender|criminal|convicted|felony|background check|date of birth|\bage\b|marital|religio/i;

type Resolver = (s: ScreeningAnswers, p: UserProfile, job: Job) => string | null;

const yesNo = (v: boolean | null | undefined): string | null =>
  v === true ? "Yes" : v === false ? "No" : null;

const MATCHERS: Array<{ re: RegExp; resolve: Resolver }> = [
  // Authorisation and sponsorship. Order matters: a question asking both
  // ("authorised to work without sponsorship?") must not be caught by the
  // plain sponsorship rule below.
  {
    re: /authori[sz]ed.*without.*sponsor|work.*without.*sponsor/i,
    resolve: (s) =>
      s.authorizedToWork === null || s.requiresSponsorship === null
        ? null
        : yesNo(s.authorizedToWork && !s.requiresSponsorship),
  },
  {
    re: /sponsor/i,
    resolve: (s) => yesNo(s.requiresSponsorship),
  },
  {
    re: /authori[sz]ed to work|legally authori|right to work|eligible to work|work permit/i,
    resolve: (s) => yesNo(s.authorizedToWork),
  },

  // Relocation and location.
  {
    re: /relocat/i,
    resolve: (s) => {
      const base = yesNo(s.openToRelocation);
      if (!base) return null;
      return s.openToRelocation && s.willingToRelocateTo
        ? `Yes — ${s.willingToRelocateTo}`
        : base;
    },
  },
  {
    re: /where.*(are you|do you) (based|located|live)|current location|city of residence|address from which/i,
    resolve: (_s, p) => p.targetLocations?.[0] || null,
  },

  // Experience.
  {
    re: /how many years|years of (professional )?experience|years.*experience.*with|total experience/i,
    resolve: (s) => (s.yearsOfExperience === null ? null : String(s.yearsOfExperience)),
  },

  // Availability.
  {
    re: /earliest.*start|start date|when.*(can|could|would) you (start|begin)|availability|available to start/i,
    resolve: (s, p) => s.earliestStartDate || p.noticePeriod || null,
  },
  {
    re: /notice period/i,
    resolve: (_s, p) => p.noticePeriod || null,
  },

  // Compensation.
  {
    re: /salary|compensation (expectation|requirement)|expected (pay|comp)|desired (salary|comp)/i,
    resolve: (_s, p) =>
      p.minSalary > 0
        ? `${p.salaryCurrency || "USD"} ${p.minSalary.toLocaleString()}+`
        : null,
  },

  // Sourcing.
  {
    re: /how did you (hear|find out|learn)|where did you (hear|find)|referral source/i,
    resolve: (s) => s.howDidYouHear || null,
  },

  // Links.
  { re: /linked\s*-?in/i,               resolve: (_s, p) => p.links?.linkedin  || null },
  { re: /git\s*hub/i,                   resolve: (_s, p) => p.links?.github    || null },
  { re: /portfolio|personal (website|site)/i, resolve: (_s, p) => p.links?.portfolio || null },

  // Work model.
  {
    re: /work (in.?person|on.?site|from an office)|open to.*(hybrid|office)|willing to work on.?site/i,
    resolve: (_s, p) =>
      p.remotePreference === "Remote" ? "No — seeking remote roles"
      : p.remotePreference === "On-site" || p.remotePreference === "Hybrid" ? "Yes"
      : p.remotePreference === "Flexible" ? "Yes"
      : null,
  },
];

function fillPlaceholders(answer: string, job: Job): string {
  return answer
    .replace(/\{company\}/gi, job.company)
    .replace(/\{role\}/gi, job.title)
    .replace(/\{title\}/gi, job.title);
}

/** Free-text answers the user saved, matched by their own pattern. */
function fromAnswerBank(question: string, s: ScreeningAnswers, job: Job): string | null {
  for (const entry of s.answerBank ?? []) {
    if (!entry?.pattern || !entry.answer) continue;
    let hit = false;
    try {
      hit = new RegExp(entry.pattern, "i").test(question);
    } catch {
      // Treat an invalid regex as a plain substring, which is what a user
      // typing "why do you want to work here" intends anyway.
      hit = question.toLowerCase().includes(entry.pattern.toLowerCase());
    }
    if (hit) return fillPlaceholders(entry.answer, job);
  }
  return null;
}

export const EMPTY_SCREENING: ScreeningAnswers = {
  authorizedToWork: null,
  requiresSponsorship: null,
  openToRelocation: null,
  willingToRelocateTo: "",
  yearsOfExperience: null,
  earliestStartDate: "",
  howDidYouHear: "",
  answerBank: [],
};

/**
 * Answer one question from the profile, or return null if it cannot be
 * grounded there.
 */
export function answerFromProfile(
  question: string,
  profile: UserProfile,
  job: Job
): string | null {
  if (NEVER_AUTO_ANSWER.test(question)) return null;

  const screening = profile.screening ?? EMPTY_SCREENING;

  const banked = fromAnswerBank(question, screening, job);
  if (banked) return banked;

  for (const { re, resolve } of MATCHERS) {
    if (!re.test(question)) continue;
    const value = resolve(screening, profile, job);
    if (value) return value;
    // Matched the topic but the profile has no value for it — stop rather
    // than let a later, looser pattern answer the wrong question.
    return null;
  }

  return null;
}

export interface ScreeningSplit {
  answered: Record<string, string>;
  /** Questions to hand to the AI drafter. */
  remaining: string[];
  /** Questions deliberately left for the user. */
  withheld: string[];
}

/** Answer everything the profile covers; report what is left. */
export function answerAllFromProfile(
  questions: string[],
  profile: UserProfile,
  job: Job
): ScreeningSplit {
  const answered: Record<string, string> = {};
  const remaining: string[] = [];
  const withheld: string[] = [];

  for (const q of questions) {
    if (NEVER_AUTO_ANSWER.test(q)) {
      withheld.push(q);
      continue;
    }
    const a = answerFromProfile(q, profile, job);
    if (a) answered[q] = a;
    else remaining.push(q);
  }

  if (withheld.length > 0) {
    logger.info(
      `[screening] Left ${withheld.length} personal/legal question(s) for manual answer`
    );
  }
  return { answered, remaining, withheld };
}
