/**
 * local-engine.ts
 *
 * A self-contained, zero-dependency matching and generation engine.
 * Used when no AI API keys are configured (AI_MODE=local or no keys set).
 *
 * Scoring algorithm:
 *   - Keyword overlap between CV and job description   (40 pts)
 *   - Title match against target titles                (25 pts)
 *   - Location / remote match                          (15 pts)
 *   - Seniority / experience level match               (10 pts)
 *   - Industry signals in description                  (10 pts)
 *   Total: 100 pts
 */

import type { AIMatchResult, UserProfile, Job } from "../types/index.js";

// ─── Text helpers ─────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+#]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Count how many tokens from `needles` appear in `haystack` tokens */
function overlap(needles: string[], haystack: string[]): number {
  const haystackSet = new Set(haystack);
  return needles.filter((n) => haystackSet.has(n)).length;
}

/** Simple TF-IDF-style overlap score (0–1) */
function overlapScore(a: string, b: string): number {
  const at = unique(tokenise(a));
  const bt = unique(tokenise(b));
  if (at.length === 0 || bt.length === 0) return 0;
  const matches = overlap(at, bt);
  // Jaccard-style: intersection / union
  const union = new Set([...at, ...bt]).size;
  return matches / union;
}

// ─── Tech keyword lists ───────────────────────────────────────────────────────

const TECH_KEYWORDS = [
  "javascript","typescript","python","java","golang","rust","ruby","php","swift","kotlin",
  "react","vue","angular","nextjs","nodejs","express","fastapi","django","rails","spring",
  "aws","gcp","azure","docker","kubernetes","terraform","ci/cd","github","gitlab",
  "postgres","mysql","mongodb","redis","elasticsearch","kafka","rabbitmq","graphql","rest",
  "microservices","serverless","devops","linux","bash","git","agile","scrum",
  "machine learning","deep learning","llm","ai","data","analytics","sql","nosql",
  "html","css","tailwind","figma","product","leadership","management","architecture",
];

const SENIORITY_MAP: Record<string, number> = {
  intern: 0, junior: 1, associate: 1, mid: 2, "mid-level": 2,
  senior: 3, lead: 4, principal: 4, staff: 4, architect: 5,
  manager: 4, director: 5, vp: 5, head: 5, chief: 6,
};

const EXPERIENCE_LEVEL_MAP: Record<string, number> = {
  Junior: 1, Mid: 2, Senior: 3, Lead: 4,
};

// ─── Core scoring ─────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  keyword: number;
  title: number;
  location: number;
  seniority: number;
  industry: number;
  total: number;
  matchedKeywords: string[];
  missingKeywords: string[];
}

function scoreJob(
  job: Pick<Job, "title" | "description" | "location" | "remote" | "seniority">,
  profile: UserProfile,
  cvText: string
): ScoreBreakdown {
  const descTokens  = unique(tokenise(job.description + " " + job.title));
  const cvTokens    = unique(tokenise(cvText || profile.baseResume));

  // ── 1. Keyword overlap (40 pts) ───────────────────────────────────────────
  const techInDesc  = TECH_KEYWORDS.filter((kw) => descTokens.includes(kw));
  const techInCV    = TECH_KEYWORDS.filter((kw) => cvTokens.includes(kw));
  const matchedKeywords = techInDesc.filter((kw) => techInCV.includes(kw));
  const missingKeywords = techInDesc.filter((kw) => !techInCV.includes(kw)).slice(0, 5);

  // Raw overlap score boosted by a min-cap so short CVs don't score zero
  const rawOverlap = overlapScore(cvText || profile.baseResume, job.description);
  const keywordPts = Math.min(40, Math.round(rawOverlap * 80) + matchedKeywords.length * 2);

  // ── 2. Title match (25 pts) ───────────────────────────────────────────────
  const jobTitleTokens = tokenise(job.title);
  let titlePts = 0;
  for (const target of profile.targetTitles) {
    const targetTokens = tokenise(target);
    const titleOverlap = overlap(targetTokens, jobTitleTokens) / Math.max(targetTokens.length, 1);
    titlePts = Math.max(titlePts, Math.round(titleOverlap * 25));
  }

  // ── 3. Location / remote (15 pts) ─────────────────────────────────────────
  let locationPts = 0;
  const jobLoc = job.location.toLowerCase();
  if (job.remote && profile.remotePreference === "Remote") {
    locationPts = 15;
  } else if (job.remote && profile.remotePreference === "Flexible") {
    locationPts = 12;
  } else {
    for (const loc of profile.targetLocations) {
      if (jobLoc.includes(loc.toLowerCase()) || loc.toLowerCase().includes(jobLoc)) {
        locationPts = 15;
        break;
      }
    }
    if (locationPts === 0 && profile.targetLocations.some((l) => l.toLowerCase() === "remote")) {
      locationPts = job.remote ? 15 : 5;
    }
  }

  // ── 4. Seniority match (10 pts) ───────────────────────────────────────────
  let seniorityPts = 5; // neutral default
  if (job.seniority) {
    const jobLevel   = SENIORITY_MAP[job.seniority.toLowerCase()] ?? 2;
    const profileLevel = EXPERIENCE_LEVEL_MAP[profile.experienceLevel] ?? 2;
    const delta = Math.abs(jobLevel - profileLevel);
    seniorityPts = delta === 0 ? 10 : delta === 1 ? 7 : delta === 2 ? 3 : 0;
  }

  // ── 5. Industry signals (10 pts) ──────────────────────────────────────────
  let industryPts = 0;
  for (const industry of profile.targetIndustries) {
    const indTokens = tokenise(industry);
    if (indTokens.some((t) => descTokens.includes(t))) {
      industryPts = 10;
      break;
    }
  }

  const total = Math.min(100, keywordPts + titlePts + locationPts + seniorityPts + industryPts);

  return { keyword: keywordPts, title: titlePts, location: locationPts, seniority: seniorityPts, industry: industryPts, total, matchedKeywords, missingKeywords };
}

// ─── Public: match job with CV (no API) ───────────────────────────────────────

export function localMatchJobWithCV(
  job: Pick<Job, "title" | "description" | "company" | "location" | "remote" | "seniority">,
  cvText: string,
  profile: UserProfile
): AIMatchResult {
  const bd = scoreJob(job, profile, cvText);
  const score = bd.total;
  const recommendation: "apply" | "skip" = score >= profile.minMatchScore ? "apply" : "skip";

  const justification: string[] = [];
  if (bd.matchedKeywords.length > 0) {
    justification.push(`Matched ${bd.matchedKeywords.length} technical keywords: ${bd.matchedKeywords.slice(0, 5).join(", ")}`);
  }
  if (bd.title > 15) justification.push(`Job title aligns well with your target roles`);
  if (bd.location >= 12) justification.push(`Location/remote preference matched`);
  if (bd.seniority >= 7) justification.push(`Seniority level is a good fit for your experience`);
  if (bd.industry === 10) justification.push(`Industry aligns with your target sectors`);
  if (justification.length === 0) justification.push(`Partial match — review manually`);

  const risksGaps = bd.missingKeywords.length > 0
    ? `Missing keywords in your CV: ${bd.missingKeywords.join(", ")}. Consider adding relevant experience.`
    : `No significant gaps identified via keyword analysis.`;

  const cvSuggestions: string[] = [];
  if (bd.missingKeywords.length > 0) {
    cvSuggestions.push(`Highlight experience with: ${bd.missingKeywords.join(", ")}`);
  }
  if (bd.title < 10) cvSuggestions.push(`Your CV headline could better reflect the target role: "${job.title}"`);

  const prediction =
    score >= 80 ? "High Interview Probability" :
    score >= 65 ? "Competitive Candidate" :
    score >= 45 ? "Possible Match — Tailor CV" :
    "Low Match — Consider Skipping";

  const confidence = Math.min(75, 30 + score * 0.45); // cap at 75% for local engine

  const coverLetter = buildCoverLetter(job, profile);

  return {
    score,
    recommendation,
    reasoning: `Local keyword-based scoring: ${score}/100. Keyword overlap: ${bd.keyword}/40, title: ${bd.title}/25, location: ${bd.location}/15, seniority: ${bd.seniority}/10, industry: ${bd.industry}/10.`,
    matchJustification: justification,
    risksGaps,
    cvSuggestions,
    coverLetter,
    prediction,
    confidence: Math.round(confidence),
  };
}

// ─── Public: generate job listings without AI ─────────────────────────────────

const SAMPLE_COMPANIES = [
  "TechCorp", "DataSystems Inc", "CloudBase", "DevFactory", "InnovateLabs",
  "NexGen Solutions", "Pulse Technologies", "Apex Digital", "CoreStack", "GridWorks",
  "Synthetix", "QuantumLeap", "ByteForge", "Helix Engineering", "Axiom Labs",
];

const SAMPLE_DESCRIPTIONS: Record<string, string> = {
  "Software Engineer":
    "Build and maintain scalable web services using modern technologies. Work closely with product and design teams in an agile environment. Strong focus on code quality, testing, and continuous deployment.",
  "Full Stack Developer":
    "Design and implement full-stack features from database to UI. Proficiency in React, Node.js, and cloud infrastructure required. Collaborate with cross-functional teams to deliver high-impact features.",
  "Backend Engineer":
    "Architect and scale distributed backend systems handling millions of requests. Deep knowledge of databases, caching, and message queues expected. Own reliability and performance of core services.",
  "Frontend Engineer":
    "Craft pixel-perfect, performant user interfaces using React and TypeScript. Work with designers to implement design systems. Champion accessibility and web performance best practices.",
  "DevOps Engineer":
    "Manage CI/CD pipelines, Kubernetes clusters, and cloud infrastructure on AWS/GCP. Drive automation of deployment and monitoring. Partner with engineering teams to improve developer experience.",
  "Data Engineer":
    "Build and maintain data pipelines processing petabytes of data. Expertise in Spark, dbt, and data warehouse technologies required. Enable data-driven decisions across the organisation.",
  "Machine Learning Engineer":
    "Design and deploy ML models from prototype to production. Experience with PyTorch or TensorFlow and MLOps practices essential. Work at the intersection of research and engineering.",
  "Product Manager":
    "Drive product strategy and roadmap for a core product area. Work with engineering, design, and data teams to ship impactful features. Strong analytical and communication skills required.",
};

const LOCATIONS = [
  "Remote", "San Francisco, CA", "New York, NY", "Austin, TX",
  "London, UK", "Berlin, Germany", "Toronto, Canada", "Remote (US)",
];

const SALARIES = [
  "$80k–$110k", "$100k–$130k", "$120k–$160k", "$140k–$180k",
  "$90k–$120k", "£60k–£90k", "€70k–€100k", "Competitive",
];

const PLATFORMS = ["linkedin", "indeed", "greenhouse"];

export function localParseCV(text: string): Partial<UserProfile> {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // Try to extract email
  const emailMatch = text.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/);

  // Try to extract phone
  const phoneMatch = text.match(/[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{4,8}/);

  // Try to extract name (first non-empty line that looks like a name)
  let fullName = "";
  for (const line of lines.slice(0, 5)) {
    if (line.length < 50 && /^[A-Z][a-z]+ [A-Z]/.test(line)) {
      fullName = line;
      break;
    }
  }

  // Extract experience level from keywords
  const lowerText = text.toLowerCase();
  let experienceLevel: "Junior" | "Mid" | "Senior" | "Lead" = "Mid";
  if (/(senior|sr\.|lead|principal|staff|architect)/i.test(lowerText)) {
    experienceLevel = lowerText.includes("lead") || lowerText.includes("principal") ? "Lead" : "Senior";
  } else if (/(junior|jr\.|entry.?level|graduate|intern)/i.test(lowerText)) {
    experienceLevel = "Junior";
  }

  // Extract possible job titles mentioned
  const titleCandidates: string[] = [];
  for (const kw of ["engineer", "developer", "manager", "designer", "analyst", "architect", "scientist"]) {
    const regex = new RegExp(`\\b([a-z\\s]{0,30}${kw}[a-z\\s]{0,20})`, "gi");
    const matches = text.match(regex);
    if (matches) {
      const cleaned = matches[0].trim().replace(/\b\w/g, (c) => c.toUpperCase());
      if (!titleCandidates.includes(cleaned)) titleCandidates.push(cleaned);
    }
  }

  // Build summary from first meaningful paragraph
  let baseResume = "";
  for (const line of lines) {
    if (line.length > 60 && !/^\d/.test(line) && !line.includes("@")) {
      baseResume = line.slice(0, 300);
      break;
    }
  }
  if (!baseResume && lines.length > 0) {
    baseResume = lines.slice(0, 3).join(" ").slice(0, 300);
  }

  return {
    ...(fullName && { fullName }),
    ...(emailMatch && { email: emailMatch[0] }),
    ...(phoneMatch && { phone: phoneMatch[0] }),
    ...(baseResume && { baseResume }),
    ...(titleCandidates.length > 0 && { targetTitles: titleCandidates.slice(0, 3) }),
    experienceLevel,
  };
}

// ─── Public: application pack without AI ─────────────────────────────────────

export function localGenerateApplicationPack(
  job: Pick<Job, "title" | "company" | "url">,
  profile: UserProfile,
  coverLetter: string
): Record<string, unknown> {
  const today = new Date();
  const followUp1 = new Date(today.getTime() + 7 * 86400000).toLocaleDateString();
  const followUp2 = new Date(today.getTime() + 14 * 86400000).toLocaleDateString();

  return {
    jobSnapshot: {
      link: job.url,
      source: "manual",
      workModel: "Unknown",
    },
    resumeEdits: {
      headline: `${profile.experienceLevel} ${job.title}`,
      summary: profile.baseResume.slice(0, 200),
      coreSkills: profile.targetIndustries.concat(profile.targetTitles).slice(0, 6),
      bulletEdits: [
        `Tailor your top 3 bullet points to mention the specific technologies listed in this job description`,
        `Quantify achievements with metrics where possible (e.g. "reduced build time by 40%")`,
      ],
    },
    coverLetter,
    formAnswers: {
      whyFit:            `My experience as a ${profile.experienceLevel} professional aligns closely with the requirements for this ${job.title} role at ${job.company}.`,
      salaryExpectation: profile.minSalary > 0 ? `$${profile.minSalary.toLocaleString()}+` : "Open to discussion",
      availability:      profile.noticePeriod || "Immediate",
    },
    checklist: [
      "Tailor CV headline and summary to match the job title",
      "Verify all contact details are current",
      "Attach the correct CV version",
      "Review the cover letter for company-specific references",
      "Research the company before any interview",
    ],
    trackerRow: `${job.company} | ${job.title} | Applied ${today.toLocaleDateString()} | Pending`,
    followUpSchedule: {
      date1: followUp1,
      date2: followUp2,
      templates: {
        recruiter: `Hi [Name], I wanted to follow up on my application for the ${job.title} position at ${job.company}. I remain very interested and would love to discuss further. Best, ${profile.fullName}`,
        hiringManager: `Dear Hiring Manager, I applied for the ${job.title} role on ${today.toLocaleDateString()} and am enthusiastic about the opportunity to contribute to ${job.company}. Please let me know if you need any additional information. Best regards, ${profile.fullName}`,
      },
    },
    atsCheck: {
      keywordsPresent: false,
      missingMustHaves: ["Run an ATS checker (e.g. Jobscan) manually — local mode cannot analyse keywords against the JD"],
    },
  };
}

// ─── Cover letter template ────────────────────────────────────────────────────

function buildCoverLetter(
  job: Pick<Job, "title" | "company">,
  profile: UserProfile
): string {
  const name    = profile.fullName || "Applicant";
  const summary = profile.baseResume
    ? profile.baseResume.slice(0, 200)
    : `an experienced ${profile.experienceLevel} professional`;

  return `Dear Hiring Team,

I am writing to express my strong interest in the ${job.title} position at ${job.company}.

${summary}

I am particularly drawn to ${job.company} because of the opportunity to contribute meaningfully in the ${job.title} role. My background in ${profile.targetIndustries.slice(0, 2).join(" and ") || "technology"} and experience level as a ${profile.experienceLevel} professional positions me well to add immediate value to your team.

I would welcome the opportunity to discuss how my skills and experience align with your needs. Thank you for considering my application.

Best regards,
${name}
${profile.links?.linkedin ? "\n" + profile.links.linkedin : ""}`.trim();
}
