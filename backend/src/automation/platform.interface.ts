import type { Job, UserProfile } from "../types/index.js";

export interface RawJob {
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
}

export interface JobPlatform {
  readonly name: string;
  login(profile: UserProfile): Promise<void>;
  searchJobs(profile: UserProfile): Promise<RawJob[]>;
  applyToJob(job: Job, coverLetter: string, cvPath: string): Promise<boolean>;
  close(): Promise<void>;
}
