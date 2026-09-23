import { Router } from "express";
import { db } from "../../db/index.js";
import { asyncHandler } from "../middleware/error.js";
import type { JobStatus } from "../../types/index.js";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const statusRaw  = Array.isArray(req.query.status)   ? String(req.query.status[0])   : req.query.status   as string | undefined;
  const platform   = Array.isArray(req.query.platform)  ? String(req.query.platform[0]) : req.query.platform as string | undefined;
  const limitRaw   = Array.isArray(req.query.limit)     ? String(req.query.limit[0])    : req.query.limit    as string | undefined;
  const status     = statusRaw as JobStatus | undefined;
  const limit      = limitRaw ? parseInt(limitRaw, 10) : 100;
  const [jobs, stats] = await Promise.all([db.listJobs({ status, platform, limit }), db.getStats()]);
  res.json({ success: true, data: { jobs, stats } });
}));

router.get("/stats", asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await db.getStats() });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = await db.getJobById(id);
  if (!job) { res.status(404).json({ success: false, error: "Job not found" }); return; }
  res.json({ success: true, data: job });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = await db.getJobById(id);
  if (!job) { res.status(404).json({ success: false, error: "Job not found" }); return; }
  await db.deleteJob(id);
  res.json({ success: true, data: { deleted: id } });
}));

router.delete("/", asyncHandler(async (_req, res) => {
  const jobs = await db.listJobs();
  await Promise.all(jobs.map((j) => db.deleteJob(j.id)));
  res.json({ success: true, data: { deleted: jobs.length } });
}));

export { router as jobsRouter };
