/**
 * db/sqlite-db.ts — SQLite implementation (local dev + Docker).
 * Original synchronous implementation using better-sqlite3.
 */

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger.js";
import type {
  User, Job, Application, LogEntry, Integration,
  JobStatus, LogLevel, ApplicationPack,
  OrchestratorStats, UserProfile, ApplicationStatus,
} from "../types/index.js";
import type { DbAdapter } from "./adapter.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "./data";
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads", { recursive: true });

const sqlite = new Database(path.join(DATA_DIR, "jobs.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// ─── Schema ───────────────────────────────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    profile TEXT NOT NULL DEFAULT '{}',
    cv_filename TEXT,
    cv_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    salary TEXT,
    remote INTEGER NOT NULL DEFAULT 0,
    seniority TEXT,
    employment_type TEXT,
    posted_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    match_score REAL,
    match_justification TEXT NOT NULL DEFAULT '[]',
    risks_gaps TEXT,
    ai_recommendation TEXT,
    prediction TEXT,
    confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, external_id)
  );

  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    job_title TEXT NOT NULL,
    company TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    match_score REAL NOT NULL DEFAULT 0,
    pack TEXT,
    prediction TEXT,
    confidence REAL,
    applied_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    context TEXT,
    job_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    platform TEXT UNIQUE NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    last_used TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Seed defaults ────────────────────────────────────────────────────────────

const userCount = (sqlite.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
if (userCount === 0) {
  const defaultProfile: UserProfile = {
    fullName: "Your Name", email: "user@example.com", phone: "",
    baseResume: "Upload your CV to get started.", baseCoverLetter: "",
    targetTitles: ["Software Engineer", "Full Stack Developer"],
    targetLocations: ["Remote"], remotePreference: "Remote", remoteOnly: true,
    targetIndustries: ["Tech", "SaaS", "AI"], excludeKeywords: [],
    experienceLevel: "Mid", minSalary: 80000, maxSalary: 0, salaryCurrency: "USD",
    workAuthorization: "", noticePeriod: "Immediate", preferEasyApply: true, automationMode: false,
    minMatchScore: 65, maxApplicationsPerDay: 20, links: {}, credentials: {},
    screening: {
      authorizedToWork: null, requiresSponsorship: null, openToRelocation: null,
      willingToRelocateTo: "", yearsOfExperience: null, earliestStartDate: "",
      howDidYouHear: "", answerBank: [],
    },
  };
  sqlite.prepare("INSERT INTO users (id, email, profile) VALUES (?, ?, ?)").run(
    uuidv4(), "user@example.com", JSON.stringify(defaultProfile)
  );
}

const ins = sqlite.prepare("INSERT OR IGNORE INTO integrations (id, platform) VALUES (?, ?)");
for (const p of ["linkedin", "indeed", "greenhouse"]) ins.run(uuidv4(), p);

logger.info("SQLite db initialised");

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string, email: row.email as string,
    profile: JSON.parse(row.profile as string) as UserProfile,
    cvFilename: (row.cv_filename as string | null) ?? null,
    cvText: (row.cv_text as string | null) ?? null,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string, platform: row.platform as string,
    externalId: row.external_id as string, title: row.title as string,
    company: row.company as string, location: row.location as string,
    description: row.description as string, url: row.url as string,
    salary: (row.salary as string | null) ?? null, remote: Boolean(row.remote),
    seniority: (row.seniority as string | null) ?? null,
    employmentType: (row.employment_type as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    status: row.status as JobStatus,
    matchScore: (row.match_score as number | null) ?? null,
    matchJustification: JSON.parse((row.match_justification as string) || "[]") as string[],
    risksGaps: (row.risks_gaps as string | null) ?? null,
    aiRecommendation: (row.ai_recommendation as "apply" | "skip" | null) ?? null,
    prediction: (row.prediction as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: row.id as string, jobId: row.job_id as string, userId: row.user_id as string,
    jobTitle: row.job_title as string, company: row.company as string,
    status: row.status as ApplicationStatus, matchScore: row.match_score as number,
    pack: row.pack ? JSON.parse(row.pack as string) as ApplicationPack : null,
    prediction: (row.prediction as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    appliedAt: (row.applied_at as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapLog(row: Record<string, unknown>): LogEntry {
  return {
    id: row.id as string, level: row.level as LogLevel,
    message: row.message as string,
    context: row.context ? JSON.parse(row.context as string) as Record<string, unknown> : null,
    jobId: (row.job_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapIntegration(row: Record<string, unknown>): Integration {
  return {
    id: row.id as string, platform: row.platform as string,
    enabled: Boolean(row.enabled),
    config: JSON.parse((row.config as string) || "{}") as Record<string, unknown>,
    lastUsed: (row.last_used as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// ─── Synchronous DbAdapter implementation ────────────────────────────────────

export const sqliteDb: DbAdapter = {
  getUser()       { const r = sqlite.prepare("SELECT * FROM users LIMIT 1").get() as Record<string,unknown>|undefined; return r ? mapUser(r) : null; },
  updateUser(patch) {
    const e = sqliteDb.getUser() as User;
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE users SET email=?,profile=?,cv_filename=?,cv_text=?,updated_at=? WHERE id=?").run(
      patch.email ?? e.email, JSON.stringify(patch.profile ?? e.profile),
      patch.cvFilename ?? e.cvFilename, patch.cvText ?? e.cvText, now, e.id
    );
    return sqliteDb.getUser() as User;
  },
  upsertJob(job) {
    const now = new Date().toISOString();
    const ex = sqlite.prepare("SELECT id FROM jobs WHERE platform=? AND external_id=?").get(job.platform, job.externalId) as {id:string}|undefined;
    if (ex) {
      sqlite.prepare("UPDATE jobs SET title=?,company=?,location=?,description=?,url=?,salary=?,remote=?,seniority=?,employment_type=?,posted_at=?,status=?,match_score=?,match_justification=?,risks_gaps=?,ai_recommendation=?,prediction=?,confidence=?,updated_at=? WHERE id=?").run(
        job.title,job.company,job.location,job.description,job.url,job.salary,job.remote?1:0,
        job.seniority,job.employmentType,job.postedAt,job.status,job.matchScore,
        JSON.stringify(job.matchJustification),job.risksGaps,job.aiRecommendation,
        job.prediction,job.confidence,now,ex.id);
      return sqliteDb.getJobById(ex.id) as Job;
    }
    const id = uuidv4();
    sqlite.prepare("INSERT INTO jobs (id,platform,external_id,title,company,location,description,url,salary,remote,seniority,employment_type,posted_at,status,match_score,match_justification,risks_gaps,ai_recommendation,prediction,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id,job.platform,job.externalId,job.title,job.company,job.location,job.description,
      job.url,job.salary,job.remote?1:0,job.seniority,job.employmentType,job.postedAt,
      job.status,job.matchScore,JSON.stringify(job.matchJustification),job.risksGaps,
      job.aiRecommendation,job.prediction,job.confidence,now,now);
    return sqliteDb.getJobById(id) as Job;
  },
  getJobById(id)  { const r = sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Record<string,unknown>|undefined; return r ? mapJob(r) : null; },
  listJobs(f={})  {
    let q="SELECT * FROM jobs WHERE 1=1"; const p:unknown[]=[];
    if(f.status)  {q+=" AND status=?";   p.push(f.status);}
    if(f.platform){q+=" AND platform=?"; p.push(f.platform);}
    q+=" ORDER BY created_at DESC";
    if(f.limit)   {q+=" LIMIT ?"; p.push(f.limit);}
    return (sqlite.prepare(q).all(...p) as Record<string,unknown>[]).map(mapJob);
  },
  updateJobStatus(id,status) { sqlite.prepare("UPDATE jobs SET status=?,updated_at=? WHERE id=?").run(status,new Date().toISOString(),id); },
  updateJobMatch(id,score,rec,just,risks,pred,conf) {
    sqlite.prepare("UPDATE jobs SET match_score=?,ai_recommendation=?,match_justification=?,risks_gaps=?,prediction=?,confidence=?,updated_at=? WHERE id=?").run(score,rec,JSON.stringify(just),risks,pred,conf,new Date().toISOString(),id);
  },
  deleteJob(id) { sqlite.prepare("DELETE FROM applications WHERE job_id=?").run(id); sqlite.prepare("DELETE FROM jobs WHERE id=?").run(id); },
  createApplication(data) {
    const id=uuidv4(),now=new Date().toISOString();
    sqlite.prepare("INSERT INTO applications (id,job_id,user_id,job_title,company,status,match_score,pack,prediction,confidence,applied_at,error_message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,data.jobId,data.userId,data.jobTitle,data.company,data.status,data.matchScore,data.pack?JSON.stringify(data.pack):null,data.prediction,data.confidence,data.appliedAt,data.errorMessage,now);
    return sqliteDb.getApplicationById(id) as Application;
  },
  getApplicationById(id) { const r=sqlite.prepare("SELECT * FROM applications WHERE id=?").get(id) as Record<string,unknown>|undefined; return r?mapApplication(r):null; },
  listApplications(limit=100) { return (sqlite.prepare("SELECT * FROM applications ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string,unknown>[]).map(mapApplication); },
  countApplicationsToday() {
    const today=new Date().toISOString().slice(0,10);
    return (sqlite.prepare("SELECT COUNT(*) as c FROM applications WHERE applied_at LIKE ? AND status='applied'").get(`${today}%`) as {c:number}).c;
  },
  addLog(level,message,context,jobId) { sqlite.prepare("INSERT INTO logs (id,level,message,context,job_id,created_at) VALUES (?,?,?,?,?,?)").run(uuidv4(),level,message,context?JSON.stringify(context):null,jobId??null,new Date().toISOString()); },
  listLogs(limit=200) { return (sqlite.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string,unknown>[]).map(mapLog); },
  clearLogs() { sqlite.prepare("DELETE FROM logs").run(); },
  listIntegrations() { return (sqlite.prepare("SELECT * FROM integrations ORDER BY platform").all() as Record<string,unknown>[]).map(mapIntegration); },
  getIntegration(platform) { const r=sqlite.prepare("SELECT * FROM integrations WHERE platform=?").get(platform) as Record<string,unknown>|undefined; return r?mapIntegration(r):null; },
  updateIntegration(platform,enabled,config) { sqlite.prepare("UPDATE integrations SET enabled=?,config=?,last_used=? WHERE platform=?").run(enabled?1:0,JSON.stringify(config),new Date().toISOString(),platform); },
  getStats() {
    const counts=(sqlite.prepare("SELECT status,COUNT(*) as c FROM jobs GROUP BY status").all() as Array<{status:string;c:number}>);
    const total=(sqlite.prepare("SELECT COUNT(*) as c FROM jobs").get() as {c:number}).c;
    const sm:Record<string,number>={};
    for(const r of counts) sm[r.status]=r.c;
    return {totalJobs:total,pending:sm["pending"]??0,running:sm["running"]??0,success:sm["success"]??0,failed:sm["failed"]??0,skipped:sm["skipped"]??0,applicationsToday:sqliteDb.countApplicationsToday() as number};
  },
};
