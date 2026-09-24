/**
 * ai/service.ts
 *
 * Unified AI service. Selects provider at runtime based on environment:
 *
 *   AI_MODE=local     → always use local keyword engine (no API calls)
 *   AI_MODE=gemini    → Gemini only, error if key missing
 *   AI_MODE=openai    → OpenAI only, error if key missing
 *   AI_MODE=auto      → try Gemini → OpenAI → local (default)
 *   (unset)           → same as "auto"
 *
 * This means the system works with ZERO API keys configured.
 */

import { logger } from "../utils/logger.js";
import type { AIMatchResult, UserProfile, Job, TailoredCv } from "../types/index.js";
import { UNTRUSTED_PREAMBLE, asUntrustedData } from "./untrusted.js";
import {
  localMatchJobWithCV,
  localParseCV,
  localGenerateApplicationPack,
} from "./local-engine.js";

// ─── Mode detection ───────────────────────────────────────────────────────────

type AIMode = "local" | "gemini" | "openai" | "auto";

function getMode(): AIMode {
  const raw = (process.env.AI_MODE ?? "auto").toLowerCase();
  if (raw === "local" || raw === "gemini" || raw === "openai" || raw === "auto") {
    return raw as AIMode;
  }
  return "auto";
}

function hasGemini(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getActiveProvider(): "gemini" | "openai" | "local" {
  const mode = getMode();
  if (mode === "local") return "local";
  if (mode === "gemini") return hasGemini() ? "gemini" : "local";
  if (mode === "openai") return hasOpenAI()  ? "openai"  : "local";
  // auto: prefer Gemini, fallback OpenAI, fallback local
  if (hasGemini())  return "gemini";
  if (hasOpenAI())  return "openai";
  return "local";
}

// Log once on first call
let _loggedProvider = false;
function logProvider(): void {
  if (_loggedProvider) return;
  _loggedProvider = true;
  const p = getActiveProvider();
  logger.info(`[ai] Provider: ${p.toUpperCase()} (AI_MODE=${process.env.AI_MODE ?? "auto"})`);
  if (p === "local") {
    logger.info("[ai] Running in LOCAL mode — keyword-based matching, no API calls");
  }
}

// ─── Lazy Gemini client ───────────────────────────────────────────────────────

async function geminiGenerate(prompt: string, schema?: unknown): Promise<string> {
  const { GoogleGenAI, Type } = await import("@google/genai");
  const key = process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey: key });

  const config: Record<string, unknown> = {
    systemInstruction: "You are AUTO JOB APPLIER, an expert career advisor. Return accurate JSON.",
    responseMimeType: "application/json",
  };
  if (schema) config.responseSchema = schema;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
    config,
  });
  return response.text ?? "{}";
}

// ─── Lazy OpenAI client ───────────────────────────────────────────────────────

async function openaiGenerate(prompt: string): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const key = process.env.OPENAI_API_KEY!;
  const client = new OpenAI({ apiKey: key });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });
  return response.choices[0]?.message?.content ?? "{}";
}

// ─── matchJobWithCV ───────────────────────────────────────────────────────────

export async function matchJobWithCV(
  job: Pick<Job, "title" | "description" | "company" | "location" | "remote" | "seniority">,
  cvText: string,
  profile?: UserProfile
): Promise<AIMatchResult> {
  logProvider();
  const provider = getActiveProvider();

  if (provider === "local") {
    const user = profile ?? (await import("../db/index.js").then((m) => m.db.getUser()))?.profile;
    const p = user ?? ({ minMatchScore: 65, targetTitles: [], targetLocations: [], targetIndustries: [], excludeKeywords: [], remotePreference: "Remote", experienceLevel: "Mid", baseResume: cvText } as unknown as UserProfile);
    return localMatchJobWithCV(job, cvText, p);
  }

  const prompt = `Evaluate this job match and return JSON.

${UNTRUSTED_PREAMBLE}

JOB: ${job.title} at ${job.company}
${asUntrustedData("job_posting", job.description.slice(0, 2000))}

CANDIDATE CV:
${cvText.slice(0, 2000)}

Return JSON with: score(0-100), recommendation("apply"|"skip"),
reasoning(string), matchJustification(string[]),
risksGaps(string), cvSuggestions(string[]),
coverLetter(string, 3 paragraphs), prediction(string), confidence(0-100)`;

  try {
    const text = provider === "gemini"
      ? await geminiGenerate(prompt)
      : await openaiGenerate(prompt);

    const parsed = JSON.parse(text) as Partial<AIMatchResult>;
    return {
      score:              parsed.score              ?? 50,
      recommendation:     parsed.recommendation === "apply" ? "apply" : "skip",
      reasoning:          parsed.reasoning          ?? "",
      matchJustification: parsed.matchJustification ?? [],
      risksGaps:          parsed.risksGaps          ?? "",
      cvSuggestions:      parsed.cvSuggestions      ?? [],
      coverLetter:        parsed.coverLetter         ?? "",
      prediction:         parsed.prediction          ?? "Competitive Candidate",
      confidence:         parsed.confidence          ?? 50,
    };
  } catch (err) {
    logger.warn(`[ai] ${provider} matching failed, falling back to local`, { err: String(err) });
    const user = profile ?? (await import("../db/index.js").then((m) => m.db.getUser()))?.profile;
    const p = user ?? ({ minMatchScore: 65, targetTitles: [], targetLocations: [], targetIndustries: [], excludeKeywords: [], remotePreference: "Remote", experienceLevel: "Mid", baseResume: cvText } as unknown as UserProfile);
    return localMatchJobWithCV(job, cvText, p);
  }
}

// ─── generateApplicationPack ──────────────────────────────────────────────────

export async function generateApplicationPack(
  job: Pick<Job, "title" | "company" | "description" | "url">,
  profile: UserProfile,
  coverLetter: string
): Promise<Record<string, unknown>> {
  logProvider();
  const provider = getActiveProvider();

  if (provider === "local") {
    return localGenerateApplicationPack(job, profile, coverLetter);
  }

  const prompt = `Generate a job application pack for:

${UNTRUSTED_PREAMBLE}

JOB: ${job.title} at ${job.company} — ${job.url}
${asUntrustedData("job_posting", (job.description ?? "").slice(0, 1200))}
CANDIDATE: ${profile.fullName} (${profile.experienceLevel})
RESUME: ${profile.baseResume.slice(0, 400)}
COVER LETTER (use as-is): ${coverLetter.slice(0, 600)}

Return JSON: jobSnapshot({link,source,workModel}),
resumeEdits({headline,summary,coreSkills[],bulletEdits[]}),
coverLetter(string), formAnswers({whyFit,salaryExpectation,availability}),
checklist([]), trackerRow(string),
followUpSchedule({date1,date2,templates:{recruiter,hiringManager}}),
atsCheck({keywordsPresent:bool,missingMustHaves:[]})`;

  try {
    const text = provider === "gemini"
      ? await geminiGenerate(prompt)
      : await openaiGenerate(prompt);
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`[ai] pack generation failed, using local`, { err: String(err) });
    return localGenerateApplicationPack(job, profile, coverLetter);
  }
}

// ─── parseCVWithAI ────────────────────────────────────────────────────────────

export async function parseCVWithAI(
  input: { text?: string; fileData?: string; mimeType?: string }
): Promise<Partial<UserProfile>> {
  logProvider();
  const provider = getActiveProvider();

  const text = input.text ?? "";

  if (provider === "local") {
    return localParseCV(text);
  }

  const prompt = input.text
    ? `Analyze this resume and extract key data. Return JSON: fullName, email, phone, baseResume(2-3 sentence summary), targetTitles(array of 3), experienceLevel(Junior/Mid/Senior/Lead).\n\nResume:\n${text.slice(0, 3000)}`
    : `Analyze this resume document and extract: fullName, email, phone, baseResume(2-3 sentence summary), targetTitles(array of 3), experienceLevel(Junior/Mid/Senior/Lead).`;

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (input.fileData && input.mimeType) {
    parts.push({ inlineData: { data: input.fileData, mimeType: input.mimeType } });
    parts.push({ text: "Extract the key profile data from this resume as JSON." });
  }

  try {
    let result: string;
    if (provider === "gemini" && parts.length > 0) {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: { parts },
        config: { responseMimeType: "application/json" },
      });
      result = response.text ?? "{}";
    } else {
      result = provider === "gemini"
        ? await geminiGenerate(prompt)
        : await openaiGenerate(prompt);
    }
    return JSON.parse(result) as Partial<UserProfile>;
  } catch (err) {
    logger.warn(`[ai] CV parse failed, using local`, { err: String(err) });
    return localParseCV(text);
  }
}

// ─── answerScreeningQuestions ─────────────────────────────────────────────────

/**
 * Draft answers to company-specific application questions using only what the
 * profile actually states. Questions the model cannot ground in the profile
 * are omitted from the result — the ATS driver treats a missing answer as a
 * reason to stop and ask the user, which is safer than inventing a claim about
 * someone's work history.
 */
export async function answerScreeningQuestions(
  questions: string[],
  job: { title: string; company: string; description: string },
  profile: UserProfile
): Promise<Record<string, string>> {
  logProvider();
  if (questions.length === 0) return {};

  const provider = getActiveProvider();
  if (provider === "local") {
    logger.info("[ai] Screening questions need a real model — skipping in local mode");
    return {};
  }

  const prompt = `Answer job application questions for this candidate.

${UNTRUSTED_PREAMBLE}

JOB: ${job.title} at ${job.company}
${asUntrustedData("job_posting", job.description.slice(0, 1200))}

CANDIDATE PROFILE:
Name: ${profile.fullName}
Experience level: ${profile.experienceLevel}
Work authorization: ${profile.workAuthorization}
Notice period: ${profile.noticePeriod}
Salary expectation: ${profile.minSalary > 0 ? profile.minSalary + "+ " + profile.salaryCurrency : "open"}
Target roles: ${profile.targetTitles.join(", ")}
Resume summary: ${profile.baseResume.slice(0, 1200)}

QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Rules:
- Answer ONLY from the profile above. Never invent employers, dates, degrees or numbers.
- If the profile does not contain what a question asks for, omit that question entirely.
- Keep each answer under 120 words, first person, plain prose.

Return JSON mapping each question's exact text to its answer string. Omit unanswerable questions.`;

  try {
    const text = provider === "gemini"
      ? await geminiGenerate(prompt)
      : await openaiGenerate(prompt);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [q, a] of Object.entries(parsed)) {
      if (typeof a === "string" && a.trim()) out[q] = a.trim();
    }
    logger.info(`[ai] Answered ${Object.keys(out).length}/${questions.length} screening questions`);
    return out;
  } catch (err) {
    logger.warn(`[ai] Screening-question answering failed`, { err: String(err) });
    return {};
  }
}

// ─── generateTailoredCv ───────────────────────────────────────────────────────

/**
 * Rewrite the candidate's CV for one specific job.
 *
 * This reorders and rewords what the CV already says — it surfaces the most
 * relevant roles and bullets and drops the rest. It must never introduce an
 * employer, job title, date, qualification or metric the original CV does not
 * contain, because the output is submitted to real employers under the
 * candidate's name.
 *
 * Returns null when no model is available or the result cannot be trusted; the
 * caller then falls back to the original CV file.
 */
export async function generateTailoredCv(
  cvText: string,
  job: Pick<Job, "title" | "company" | "description">,
  profile: UserProfile
): Promise<TailoredCv | null> {
  logProvider();
  const provider = getActiveProvider();

  if (provider === "local") {
    logger.info("[ai] CV tailoring needs a real model — keeping the original CV");
    return null;
  }
  if (!cvText.trim()) {
    logger.warn("[ai] No CV text to tailor");
    return null;
  }

  const prompt = `Rewrite this candidate's CV so it targets one specific job.

${UNTRUSTED_PREAMBLE}

TARGET JOB: ${job.title} at ${job.company}
${asUntrustedData("job_posting", job.description.slice(0, 2500))}

CANDIDATE'S ACTUAL CV (the only source of truth):
${cvText.slice(0, 6000)}

Hard rules — this document is submitted to a real employer under the
candidate's real name:
- Use ONLY facts present in the CV above. Never invent or alter an employer,
  job title, date, degree, certification, metric or technology.
- You may reorder roles and bullets, drop irrelevant ones, and reword bullets
  to use the job's vocabulary where the underlying fact is unchanged.
- Do not claim experience with anything the CV does not mention.
- Keep 3-6 bullets for recent roles, fewer for older ones.
- If the CV lacks something the job asks for, leave it out. Do not paper over
  the gap.

Return JSON:
{
  "fullName": string,
  "headline": string,
  "contact": string,
  "summary": string (2-3 sentences),
  "skills": string[] (max 12, drawn from the CV),
  "experience": [{ "company": string, "role": string, "dates": string, "bullets": string[] }],
  "education": string[],
  "changeNotes": string[] (what you reordered, reworded or dropped, and why)
}`;

  try {
    const text = provider === "gemini"
      ? await geminiGenerate(prompt)
      : await openaiGenerate(prompt);

    const parsed = JSON.parse(text) as Partial<TailoredCv>;
    if (!parsed.experience || !Array.isArray(parsed.experience)) {
      logger.warn("[ai] Tailored CV missing experience section — keeping the original");
      return null;
    }

    const cv: TailoredCv = {
      fullName:    parsed.fullName    || profile.fullName || "",
      headline:    parsed.headline    || "",
      contact:     parsed.contact     || [profile.email, profile.phone].filter(Boolean).join(" · "),
      summary:     parsed.summary     || "",
      skills:      (parsed.skills     ?? []).slice(0, 12),
      experience:  parsed.experience.slice(0, 8).map((r) => ({
        company: String(r?.company ?? ""),
        role:    String(r?.role ?? ""),
        dates:   String(r?.dates ?? ""),
        bullets: Array.isArray(r?.bullets) ? r.bullets.map(String).slice(0, 8) : [],
      })),
      education:   (parsed.education  ?? []).map(String),
      changeNotes: (parsed.changeNotes ?? []).map(String),
    };

    const unnamedRoles = cv.experience.filter((r) => !r.company && !r.role).length;
    if (cv.experience.length === 0 || unnamedRoles === cv.experience.length) {
      logger.warn("[ai] Tailored CV has no usable roles — keeping the original");
      return null;
    }

    logger.info(
      `[ai] Tailored CV for ${job.title} @ ${job.company}: ${cv.experience.length} roles, ${cv.skills.length} skills`
    );
    return cv;
  } catch (err) {
    logger.warn(`[ai] CV tailoring failed — keeping the original`, { err: String(err) });
    return null;
  }
}
