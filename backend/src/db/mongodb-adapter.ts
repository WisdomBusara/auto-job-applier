/**
 * db/mongodb-adapter.ts — MongoDB implementation
 * Used when MONGODB_URL is set in environment.
 */

import { MongoClient, Db, Collection } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";
import type {
  User, Job, Application, LogEntry, Integration,
  JobStatus, LogLevel, ApplicationPack,
  OrchestratorStats, UserProfile, ApplicationStatus,
} from "../types/index.js";
import type { DbAdapter } from "./adapter.js";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017/auto-job-applier";

let client: MongoClient;
let db: Db;
let usersCol: Collection;
let jobsCol: Collection;
let appsCol: Collection;
let logsCol: Collection;
let integrationsCol: Collection;

async function connect() {
  if (db) return;
  try {
    client = new MongoClient(MONGODB_URL);
    await client.connect();
    db = client.db("auto-job-applier");

    usersCol = db.collection("users");
    jobsCol = db.collection("jobs");
    appsCol = db.collection("applications");
    logsCol = db.collection("logs");
    integrationsCol = db.collection("integrations");

    // Create indexes
    await usersCol.createIndex({ email: 1 }, { unique: true });
    await jobsCol.createIndex({ platform: 1, externalId: 1 }, { unique: true });
    await jobsCol.createIndex({ status: 1 });
    await jobsCol.createIndex({ createdAt: -1 });
    await appsCol.createIndex({ jobId: 1 });
    await appsCol.createIndex({ userId: 1 });
    await appsCol.createIndex({ appliedAt: 1 });
    await logsCol.createIndex({ createdAt: -1 });
    await integrationsCol.createIndex({ platform: 1 }, { unique: true });

    logger.info("MongoDB connected");
  } catch (err) {
    logger.error(`MongoDB connection failed: ${String(err)}`);
    throw err;
  }
}

// Row mappers
function mapUserDoc(doc: any): User {
  return {
    id: doc._id,
    email: doc.email,
    profile: doc.profile as UserProfile,
    cvFilename: doc.cvFilename ?? null,
    cvText: doc.cvText ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapJobDoc(doc: any): Job {
  return {
    id: doc._id,
    platform: doc.platform,
    externalId: doc.externalId,
    title: doc.title,
    company: doc.company,
    location: doc.location || "",
    description: doc.description || "",
    url: doc.url,
    salary: doc.salary ?? null,
    remote: doc.remote || false,
    seniority: doc.seniority ?? null,
    employmentType: doc.employmentType ?? null,
    postedAt: doc.postedAt ?? null,
    status: doc.status as JobStatus,
    matchScore: doc.matchScore ?? null,
    matchJustification: doc.matchJustification || [],
    risksGaps: doc.risksGaps ?? null,
    aiRecommendation: doc.aiRecommendation ?? null,
    prediction: doc.prediction ?? null,
    confidence: doc.confidence ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapApplicationDoc(doc: any): Application {
  return {
    id: doc._id,
    jobId: doc.jobId,
    userId: doc.userId,
    jobTitle: doc.jobTitle,
    company: doc.company,
    status: doc.status as ApplicationStatus,
    matchScore: doc.matchScore,
    pack: doc.pack ?? null,
    prediction: doc.prediction ?? null,
    confidence: doc.confidence ?? null,
    appliedAt: doc.appliedAt ?? null,
    errorMessage: doc.errorMessage ?? null,
    createdAt: doc.createdAt,
  };
}

function mapLogDoc(doc: any): LogEntry {
  return {
    id: doc._id,
    level: doc.level as LogLevel,
    message: doc.message,
    context: doc.context ?? null,
    jobId: doc.jobId ?? null,
    createdAt: doc.createdAt,
  };
}

function mapIntegrationDoc(doc: any): Integration {
  return {
    id: doc._id,
    platform: doc.platform,
    enabled: doc.enabled || false,
    config: doc.config || {},
    lastUsed: doc.lastUsed ?? null,
    createdAt: doc.createdAt,
  };
}

// Initialize database with defaults on first run
async function seedDefaults() {
  const userCount = await usersCol.countDocuments();
  if (userCount === 0) {
    const defaultProfile: UserProfile = {
      fullName: "Your Name",
      email: "user@example.com",
      phone: "",
      baseResume: "Upload your CV to get started.",
      baseCoverLetter: "",
      targetTitles: ["Software Engineer", "Full Stack Developer"],
      targetLocations: ["Remote"],
      remotePreference: "Remote",
      targetIndustries: ["Tech", "SaaS", "AI"],
      excludeKeywords: [],
      experienceLevel: "Mid",
      minSalary: 0,
      workAuthorization: "",
      noticePeriod: "Immediate",
      preferEasyApply: true,
      automationMode: false,
      minMatchScore: 65,
      maxApplicationsPerDay: 20,
      links: {},
      credentials: {},
    };

    await usersCol.insertOne({
      _id: uuidv4(),
      email: "user@example.com",
      profile: defaultProfile,
      cvFilename: null,
      cvText: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const platforms = ["linkedin", "indeed", "greenhouse"];
  for (const platform of platforms) {
    const exists = await integrationsCol.findOne({ platform });
    if (!exists) {
      await integrationsCol.insertOne({
        _id: uuidv4(),
        platform,
        enabled: false,
        config: {},
        lastUsed: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

// Async DbAdapter implementation
export const mongoDbAdapter: DbAdapter = {
  async getUser() {
    await connect();
    const user = await usersCol.findOne({});
    return user ? mapUserDoc(user) : null;
  },

  async updateUser(patch) {
    await connect();
    const user = (await mongoDbAdapter.getUser()) as User;
    const now = new Date().toISOString();

    await usersCol.updateOne(
      { _id: user.id },
      {
        $set: {
          email: patch.email ?? user.email,
          profile: patch.profile ?? user.profile,
          cvFilename: patch.cvFilename ?? user.cvFilename,
          cvText: patch.cvText ?? user.cvText,
          updatedAt: now,
        },
      }
    );

    return (await mongoDbAdapter.getUser()) as User;
  },

  async upsertJob(job) {
    await connect();
    const now = new Date().toISOString();

    const existing = await jobsCol.findOne({
      platform: job.platform,
      externalId: job.externalId,
    });

    if (existing) {
      await jobsCol.updateOne(
        { _id: existing._id },
        {
          $set: {
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description,
            url: job.url,
            salary: job.salary,
            remote: job.remote,
            seniority: job.seniority,
            employmentType: job.employmentType,
            postedAt: job.postedAt,
            status: job.status,
            matchScore: job.matchScore,
            matchJustification: job.matchJustification,
            risksGaps: job.risksGaps,
            aiRecommendation: job.aiRecommendation,
            prediction: job.prediction,
            confidence: job.confidence,
            updatedAt: now,
          },
        }
      );

      return (await mongoDbAdapter.getJobById(existing._id)) as Job;
    }

    const id = uuidv4();
    await jobsCol.insertOne({
      _id: id,
      platform: job.platform,
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      url: job.url,
      salary: job.salary,
      remote: job.remote,
      seniority: job.seniority,
      employmentType: job.employmentType,
      postedAt: job.postedAt,
      status: job.status,
      matchScore: job.matchScore,
      matchJustification: job.matchJustification,
      risksGaps: job.risksGaps,
      aiRecommendation: job.aiRecommendation,
      prediction: job.prediction,
      confidence: job.confidence,
      createdAt: now,
      updatedAt: now,
    });

    return (await mongoDbAdapter.getJobById(id)) as Job;
  },

  async getJobById(id) {
    await connect();
    const job = await jobsCol.findOne({ _id: id });
    return job ? mapJobDoc(job) : null;
  },

  async listJobs(filters = {}) {
    await connect();
    const query: any = {};

    if (filters.status) query.status = filters.status;
    if (filters.platform) query.platform = filters.platform;

    const jobs = await jobsCol
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 1000)
      .toArray();

    return jobs.map(mapJobDoc);
  },

  async updateJobStatus(id, status) {
    await connect();
    await jobsCol.updateOne(
      { _id: id },
      {
        $set: {
          status,
          updatedAt: new Date().toISOString(),
        },
      }
    );
  },

  async updateJobMatch(id, score, recommendation, justification, risksGaps, prediction, confidence) {
    await connect();
    await jobsCol.updateOne(
      { _id: id },
      {
        $set: {
          matchScore: score,
          aiRecommendation: recommendation,
          matchJustification: justification,
          risksGaps: risksGaps,
          prediction: prediction,
          confidence: confidence,
          updatedAt: new Date().toISOString(),
        },
      }
    );
  },

  async deleteJob(id) {
    await connect();
    await appsCol.deleteMany({ jobId: id });
    await jobsCol.deleteOne({ _id: id });
  },

  async createApplication(data) {
    await connect();
    const id = uuidv4();
    const now = new Date().toISOString();

    await appsCol.insertOne({
      _id: id,
      jobId: data.jobId,
      userId: data.userId,
      jobTitle: data.jobTitle,
      company: data.company,
      status: data.status,
      matchScore: data.matchScore,
      pack: data.pack || null,
      prediction: data.prediction || null,
      confidence: data.confidence || null,
      appliedAt: data.appliedAt || null,
      errorMessage: data.errorMessage || null,
      createdAt: now,
    });

    return (await mongoDbAdapter.getApplicationById(id)) as Application;
  },

  async getApplicationById(id) {
    await connect();
    const app = await appsCol.findOne({ _id: id });
    return app ? mapApplicationDoc(app) : null;
  },

  async listApplications(limit = 100) {
    await connect();
    const apps = await appsCol
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return apps.map(mapApplicationDoc);
  },

  async countApplicationsToday() {
    await connect();
    const today = new Date().toISOString().slice(0, 10);
    const startOfDay = `${today}T00:00:00`;
    const endOfDay = `${today}T23:59:59`;

    return await appsCol.countDocuments({
      appliedAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
      status: "applied",
    });
  },

  async addLog(level, message, context, jobId) {
    await connect();
    await logsCol.insertOne({
      _id: uuidv4(),
      level,
      message,
      context: context || null,
      jobId: jobId || null,
      createdAt: new Date().toISOString(),
    });
  },

  async listLogs(limit = 200) {
    await connect();
    const logs = await logsCol
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return logs.map(mapLogDoc);
  },

  async clearLogs() {
    await connect();
    await logsCol.deleteMany({});
  },

  async listIntegrations() {
    await connect();
    const integrations = await integrationsCol
      .find({})
      .sort({ platform: 1 })
      .toArray();

    return integrations.map(mapIntegrationDoc);
  },

  async getIntegration(platform) {
    await connect();
    const integration = await integrationsCol.findOne({ platform });
    return integration ? mapIntegrationDoc(integration) : null;
  },

  async updateIntegration(platform, enabled, config) {
    await connect();
    await integrationsCol.updateOne(
      { platform },
      {
        $set: {
          enabled,
          config,
          lastUsed: new Date().toISOString(),
        },
      }
    );
  },

  async getStats() {
    await connect();

    const total = await jobsCol.countDocuments();
    const statuses = await jobsCol
      .aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();

    const statusMap: Record<string, number> = {};
    for (const { _id, count } of statuses) {
      statusMap[_id] = count;
    }

    return {
      totalJobs: total,
      pending: statusMap["pending"] ?? 0,
      running: statusMap["running"] ?? 0,
      success: statusMap["success"] ?? 0,
      failed: statusMap["failed"] ?? 0,
      skipped: statusMap["skipped"] ?? 0,
      applicationsToday: await mongoDbAdapter.countApplicationsToday(),
    };
  },
};

// Initialize on module load
connect().then(() => {
  seedDefaults().catch((err) => logger.error(`Seed failed: ${String(err)}`));
});

export default mongoDbAdapter;
