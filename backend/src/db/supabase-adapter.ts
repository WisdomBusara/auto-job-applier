/**
 * db/supabase-adapter.ts
 *
 * Supabase implementation of DbAdapter.
 * Used when SUPABASE_URL is set (Vercel / cloud deployments).
 *
 * Tables mirror the SQLite schema exactly — same column names,
 * created via the SQL in /supabase/schema.sql.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "./adapter.js";
import type {
  User, Job, Application, LogEntry, Integration,
  JobStatus, LogLevel, ApplicationPack,
  OrchestratorStats, UserProfile,
} from "../types/index.js";

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null; // eslint-disable-next-line

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function client(): any {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
    _client = createClient(url, key) as unknown as SupabaseClient;
  }
  return _client;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    profile: (typeof row.profile === "string" ? JSON.parse(row.profile) : row.profile) as UserProfile,
    cvFilename: (row.cv_filename as string | null) ?? null,
    cvText: (row.cv_text as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    platform: row.platform as string,
    externalId: row.external_id as string,
    title: row.title as string,
    company: row.company as string,
    location: row.location as string,
    description: row.description as string,
    url: row.url as string,
    salary: (row.salary as string | null) ?? null,
    remote: Boolean(row.remote),
    seniority: (row.seniority as string | null) ?? null,
    employmentType: (row.employment_type as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    status: row.status as JobStatus,
    matchScore: (row.match_score as number | null) ?? null,
    matchJustification: (typeof row.match_justification === "string"
      ? JSON.parse(row.match_justification)
      : (row.match_justification ?? [])) as string[],
    risksGaps: (row.risks_gaps as string | null) ?? null,
    aiRecommendation: (row.ai_recommendation as "apply" | "skip" | null) ?? null,
    prediction: (row.prediction as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    userId: row.user_id as string,
    jobTitle: row.job_title as string,
    company: row.company as string,
    status: row.status as Application["status"],
    matchScore: row.match_score as number,
    pack: row.pack ? (typeof row.pack === "string" ? JSON.parse(row.pack) : row.pack) as ApplicationPack : null,
    prediction: (row.prediction as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    appliedAt: (row.applied_at as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapLog(row: Record<string, unknown>): LogEntry {
  return {
    id: row.id as string,
    level: row.level as LogLevel,
    message: row.message as string,
    context: row.context ? (typeof row.context === "string" ? JSON.parse(row.context) : row.context) as Record<string, unknown> : null,
    jobId: (row.job_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapIntegration(row: Record<string, unknown>): Integration {
  return {
    id: row.id as string,
    platform: row.platform as string,
    enabled: Boolean(row.enabled),
    config: (typeof row.config === "string" ? JSON.parse(row.config) : (row.config ?? {})) as Record<string, unknown>,
    lastUsed: (row.last_used as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// ─── Default profile ──────────────────────────────────────────────────────────

const DEFAULT_PROFILE: UserProfile = {
  fullName: "Your Name", email: "user@example.com", phone: "",
  baseResume: "Upload your CV to get started.", baseCoverLetter: "",
  targetTitles: ["Software Engineer", "Full Stack Developer"],
  targetLocations: ["Remote"], remotePreference: "Remote",
  targetIndustries: ["Tech", "SaaS", "AI"], excludeKeywords: [],
  experienceLevel: "Mid", minSalary: 0, workAuthorization: "",
  noticePeriod: "Immediate", preferEasyApply: true, automationMode: false,
  minMatchScore: 65, maxApplicationsPerDay: 20, links: {}, credentials: {},
};

// ─── Adapter implementation ───────────────────────────────────────────────────

export const supabaseAdapter: DbAdapter = {

  async getUser(): Promise<User | null> {
    const { data, error } = await client().from("users").select("*").limit(1).single();
    if (error || !data) {
      // Auto-create default user on first access
      const id = uuidv4();
      await client().from("users").insert({
        id, email: "user@example.com",
        profile: DEFAULT_PROFILE,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await client().from("integrations").upsert([
        { id: uuidv4(), platform: "linkedin",    enabled: false, config: {} },
        { id: uuidv4(), platform: "indeed",      enabled: false, config: {} },
        { id: uuidv4(), platform: "greenhouse",  enabled: true,  config: {} },
      ], { onConflict: "platform" });
      return supabaseAdapter.getUser();
    }
    return mapUser(data as Record<string, unknown>);
  },

  async updateUser(patch) {
    const existing = await supabaseAdapter.getUser();
    if (!existing) throw new Error("No user found");
    const { data, error } = await client().from("users").update({
      email:       patch.email       ?? existing.email,
      profile:     patch.profile     ?? existing.profile,
      cv_filename: patch.cvFilename  ?? existing.cvFilename,
      cv_text:     patch.cvText      ?? existing.cvText,
      updated_at:  new Date().toISOString(),
    }).eq("id", existing.id).select().single();
    if (error) throw new Error(error.message);
    return mapUser(data as Record<string, unknown>);
  },

  async upsertJob(job) {
    const now = new Date().toISOString();
    const { data: existing } = await client()
      .from("jobs").select("id")
      .eq("platform", job.platform).eq("external_id", job.externalId).single();

    if (existing) {
      const { data, error } = await client().from("jobs").update({
        title: job.title, company: job.company, location: job.location,
        description: job.description, url: job.url, salary: job.salary,
        remote: job.remote, seniority: job.seniority, employment_type: job.employmentType,
        posted_at: job.postedAt, status: job.status, match_score: job.matchScore,
        match_justification: job.matchJustification, risks_gaps: job.risksGaps,
        ai_recommendation: job.aiRecommendation, prediction: job.prediction,
        confidence: job.confidence, updated_at: now,
      }).eq("id", (existing as Record<string, unknown>).id).select().single();
      if (error) throw new Error(error.message);
      return mapJob(data as Record<string, unknown>);
    }

    const id = uuidv4();
    const { data, error } = await client().from("jobs").insert({
      id, platform: job.platform, external_id: job.externalId,
      title: job.title, company: job.company, location: job.location,
      description: job.description, url: job.url, salary: job.salary,
      remote: job.remote, seniority: job.seniority, employment_type: job.employmentType,
      posted_at: job.postedAt, status: job.status, match_score: job.matchScore,
      match_justification: job.matchJustification, risks_gaps: job.risksGaps,
      ai_recommendation: job.aiRecommendation, prediction: job.prediction,
      confidence: job.confidence, created_at: now, updated_at: now,
    }).select().single();
    if (error) throw new Error(error.message);
    return mapJob(data as Record<string, unknown>);
  },

  async getJobById(id) {
    const { data } = await client().from("jobs").select("*").eq("id", id).single();
    return data ? mapJob(data as Record<string, unknown>) : null;
  },

  async listJobs(filters = {}) {
    let q = client().from("jobs").select("*").order("created_at", { ascending: false });
    if (filters.status)   q = q.eq("status", filters.status);
    if (filters.platform) q = q.eq("platform", filters.platform);
    if (filters.limit)    q = q.limit(filters.limit);
    const { data } = await q;
    return (data ?? []).map((r: Record<string,unknown>) => mapJob(r as Record<string, unknown>));
  },

  async updateJobStatus(id, status) {
    await client().from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  },

  async updateJobMatch(id, score, recommendation, justification, risksGaps, prediction, confidence) {
    await client().from("jobs").update({
      match_score: score, ai_recommendation: recommendation,
      match_justification: justification, risks_gaps: risksGaps,
      prediction, confidence, updated_at: new Date().toISOString(),
    }).eq("id", id);
  },

  async deleteJob(id) {
    await client().from("applications").delete().eq("job_id", id);
    await client().from("jobs").delete().eq("id", id);
  },

  async createApplication(data) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const { data: row, error } = await client().from("applications").insert({
      id, job_id: data.jobId, user_id: data.userId,
      job_title: data.jobTitle, company: data.company,
      status: data.status, match_score: data.matchScore,
      pack: data.pack, prediction: data.prediction,
      confidence: data.confidence, applied_at: data.appliedAt,
      error_message: data.errorMessage, created_at: now,
    }).select().single();
    if (error) throw new Error(error.message);
    return mapApplication(row as Record<string, unknown>);
  },

  async getApplicationById(id) {
    const { data } = await client().from("applications").select("*").eq("id", id).single();
    return data ? mapApplication(data as Record<string, unknown>) : null;
  },

  async listApplications(limit = 100) {
    const { data } = await client().from("applications").select("*")
      .order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map((r: Record<string,unknown>) => mapApplication(r as Record<string, unknown>));
  },

  async countApplicationsToday() {
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await client().from("applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "applied").gte("applied_at", today);
    return count ?? 0;
  },

  async addLog(level, message, context, jobId) {
    await client().from("logs").insert({
      id: uuidv4(), level, message,
      context: context ?? null, job_id: jobId ?? null,
      created_at: new Date().toISOString(),
    });
  },

  async listLogs(limit = 200) {
    const { data } = await client().from("logs").select("*")
      .order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map((r: Record<string,unknown>) => mapLog(r as Record<string, unknown>));
  },

  async clearLogs() {
    await client().from("logs").delete().neq("id", "");
  },

  async listIntegrations() {
    const { data } = await client().from("integrations").select("*").order("platform");
    return (data ?? []).map((r: Record<string,unknown>) => mapIntegration(r as Record<string, unknown>));
  },

  async getIntegration(platform) {
    const { data } = await client().from("integrations").select("*").eq("platform", platform).single();
    return data ? mapIntegration(data as Record<string, unknown>) : null;
  },

  async updateIntegration(platform, enabled, config) {
    await client().from("integrations").update({
      enabled, config, last_used: new Date().toISOString(),
    }).eq("platform", platform);
  },

  async getStats() {
    const [jobsRes, appsRes] = await Promise.all([
      client().from("jobs").select("status"),
      supabaseAdapter.countApplicationsToday(),
    ]);
    const counts: Record<string, number> = {};
    for (const row of (jobsRes.data ?? [])) {
      const s = (row as Record<string, unknown>).status as string;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return {
      totalJobs: jobsRes.data?.length ?? 0,
      pending:  counts["pending"]  ?? 0,
      running:  counts["running"]  ?? 0,
      success:  counts["success"]  ?? 0,
      failed:   counts["failed"]   ?? 0,
      skipped:  counts["skipped"]  ?? 0,
      applicationsToday: appsRes,
    };
  },
};
