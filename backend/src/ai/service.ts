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
import type { AIMatchResult, UserProfile, Job } from "../types/index.js";
import {
  localMatchJobWithCV,
  localSearchJobs,
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

// ─── searchJobsWithAI ─────────────────────────────────────────────────────────

export async function searchJobsWithAI(
  profile: UserProfile
): Promise<Omit<Job, "id" | "status" | "createdAt" | "updatedAt">[]> {
  logProvider();
  const provider = getActiveProvider();

  if (provider === "local") {
    logger.info("[ai] searchJobs: local engine");
    return localSearchJobs(profile);
  }

  const prompt = `Simulate 10-15 realistic job listings for a candidate:
Titles: ${profile.targetTitles.join(", ")}
Locations: ${profile.targetLocations.join(", ")} (${profile.remotePreference})
Experience: ${profile.experienceLevel}
Industries: ${profile.targetIndustries.join(", ")}
Exclude: ${profile.excludeKeywords.join(", ")}
Resume: ${profile.baseResume.slice(0, 400)}

Return JSON array. Each item must have:
platform(string), externalId(string), title(string), company(string),
location(string), description(string, 2-3 sentences), url(string),
salary(string|null), remote(boolean), seniority(string),
employmentType(string), postedAt(ISO date string),
matchScore(null), matchJustification([]), risksGaps(null),
aiRecommendation(null), prediction(null), confidence(null)`;

  try {
    let text: string;
    if (provider === "gemini") {
      text = await geminiGenerate(prompt);
    } else {
      text = await openaiGenerate(prompt + "\n\nReturn a JSON array of job objects.");
    }

    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed) ? parsed : ((parsed as Record<string, unknown>).jobs as unknown[] ?? []);

    return (arr as Array<Record<string, unknown>>).map((j) => ({
      platform:           String(j.platform      ?? "linkedin"),
      externalId:         String(j.externalId    ?? String(Date.now() + Math.random())),
      title:              String(j.title         ?? ""),
      company:            String(j.company       ?? ""),
      location:           String(j.location      ?? ""),
      description:        String(j.description   ?? ""),
      url:                String(j.url           ?? "#"),
      salary:             (j.salary as string | null) ?? null,
      remote:             Boolean(j.remote),
      seniority:          (j.seniority as string | null) ?? null,
      employmentType:     (j.employmentType as string | null) ?? null,
      postedAt:           (j.postedAt as string | null) ?? new Date().toISOString(),
      matchScore:         null,
      matchJustification: [],
      risksGaps:          null,
      aiRecommendation:   null,
      prediction:         null,
      confidence:         null,
    }));
  } catch (err) {
    logger.warn(`[ai] ${provider} job search failed, falling back to local`, { err: String(err) });
    return localSearchJobs(profile);
  }
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

JOB: ${job.title} at ${job.company}
DESCRIPTION: ${job.description.slice(0, 2000)}

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
JOB: ${job.title} at ${job.company} — ${job.url}
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
