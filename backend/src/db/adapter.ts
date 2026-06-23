/**
 * db/adapter.ts
 *
 * Database adapter interface. Implements the same API for both:
 *   - SQLite (local dev + Docker)
 *   - Supabase (Vercel + production cloud)
 *
 * Selected by: process.env.SUPABASE_URL being set.
 */
import type {
  User, Job, Application, LogEntry, Integration,
  JobStatus, LogLevel, ApplicationPack,
  OrchestratorStats, UserProfile,
} from "../types/index.js";

export interface DbAdapter {
  getUser(): Promise<User | null> | User | null;
  updateUser(patch: Partial<Pick<User, "email" | "profile" | "cvFilename" | "cvText">>): Promise<User> | User;
  upsertJob(job: Omit<Job, "id" | "createdAt" | "updatedAt">): Promise<Job> | Job;
  getJobById(id: string): Promise<Job | null> | Job | null;
  listJobs(filters?: { status?: JobStatus; platform?: string; limit?: number }): Promise<Job[]> | Job[];
  updateJobStatus(id: string, status: JobStatus): Promise<void> | void;
  updateJobMatch(id: string, score: number, recommendation: "apply" | "skip", justification: string[], risksGaps: string, prediction: string, confidence: number): Promise<void> | void;
  deleteJob(id: string): Promise<void> | void;
  createApplication(data: Omit<Application, "id" | "createdAt">): Promise<Application> | Application;
  getApplicationById(id: string): Promise<Application | null> | Application | null;
  listApplications(limit?: number): Promise<Application[]> | Application[];
  countApplicationsToday(): Promise<number> | number;
  addLog(level: LogLevel, message: string, context?: Record<string, unknown>, jobId?: string): Promise<void> | void;
  listLogs(limit?: number): Promise<LogEntry[]> | LogEntry[];
  clearLogs(): Promise<void> | void;
  listIntegrations(): Promise<Integration[]> | Integration[];
  getIntegration(platform: string): Promise<Integration | null> | Integration | null;
  updateIntegration(platform: string, enabled: boolean, config: Record<string, unknown>): Promise<void> | void;
  getStats(): Promise<OrchestratorStats> | OrchestratorStats;
}
