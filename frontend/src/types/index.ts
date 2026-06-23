export type JobStatus = "pending" | "running" | "success" | "failed" | "skipped";
export type ApplicationStatus =
  | "planned"
  | "ready_to_submit"
  | "applied"
  | "follow_up_1"
  | "follow_up_2"
  | "interview"
  | "offer"
  | "rejected"
  | "failed";
export type LogLevel = "info" | "warn" | "error" | "debug" | "success";
export type ExperienceLevel = "Junior" | "Mid" | "Senior" | "Lead";
export type RemotePreference = "Remote" | "Hybrid" | "On-site" | "Flexible";

export interface UserProfile {
  fullName: string;
  email: string;
  phone: string;
  baseResume: string;
  baseCoverLetter: string;
  targetTitles: string[];
  targetLocations: string[];
  remotePreference: RemotePreference;
  targetIndustries: string[];
  excludeKeywords: string[];
  experienceLevel: ExperienceLevel;
  minSalary: number;
  workAuthorization: string;
  noticePeriod: string;
  preferEasyApply: boolean;
  automationMode: boolean;
  minMatchScore: number;
  maxApplicationsPerDay: number;
  links: { linkedin?: string; portfolio?: string; github?: string };
  credentials: {
    linkedinEmail?: string;
    linkedinPassword?: string;
    indeedEmail?: string;
    indeedPassword?: string;
  };
}

export interface User {
  id: string;
  email: string;
  profile: UserProfile;
  cvFilename: string | null;
  cvText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  platform: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  salary: string | null;
  remote: boolean;
  seniority: string | null;
  employmentType: string | null;
  postedAt: string | null;
  status: JobStatus;
  matchScore: number | null;
  matchJustification: string[];
  risksGaps: string | null;
  aiRecommendation: "apply" | "skip" | null;
  prediction: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationPack {
  jobSnapshot: { link: string; source: string; workModel: string };
  resumeEdits: { headline: string; summary: string; coreSkills: string[]; bulletEdits: string[] };
  coverLetter: string;
  formAnswers: Record<string, string>;
  checklist: string[];
  trackerRow: string;
  followUpSchedule: {
    date1: string;
    date2: string;
    templates: { recruiter: string; hiringManager: string };
  };
  atsCheck: { keywordsPresent: boolean; missingMustHaves: string[] };
  automationLog?: { status: "Success" | "Failed" | "Manual Required"; evidence?: string; timestamp: string };
}

export interface Application {
  id: string;
  jobId: string;
  userId: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  matchScore: number;
  pack: ApplicationPack | null;
  prediction: string | null;
  confidence: number | null;
  appliedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown> | null;
  jobId: string | null;
  createdAt: string;
}

export interface Integration {
  id: string;
  platform: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastUsed: string | null;
  createdAt: string;
}

export interface OrchestratorStats {
  totalJobs: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
  applicationsToday: number;
}

export interface OrchestratorState {
  isRunning: boolean;
  phase: "idle" | "searching" | "matching" | "applying" | "done";
  currentJobId: string | null;
  processed: number;
  applied: number;
  failed: number;
  skipped: number;
  startedAt: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SystemInfo {
  aiMode: string;
  activeProvider: "gemini" | "openai" | "local";
  geminiConfigured: boolean;
  openaiConfigured: boolean;
  supabaseConfigured: boolean;
  nodeEnv: string;
}
