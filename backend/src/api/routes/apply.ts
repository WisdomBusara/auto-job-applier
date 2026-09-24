import { Router } from "express";
import { asyncHandler } from "../middleware/error.js";
import {
  runPipeline,
  retryFailed,
  scoreAllPending,
  getOrchestratorState,
  stopPipeline,
} from "../../orchestrator/index.js";
import { db } from "../../db/index.js";

const router = Router();

// POST /api/apply/start — launch the full pipeline
router.post(
  "/start",
  asyncHandler(async (req, res) => {
    const state = getOrchestratorState();
    if (state.isRunning) {
      res.status(409).json({ success: false, error: "Pipeline already running" });
      return;
    }

    const body = req.body as {
      platforms?: string[];
      maxApplications?: number;
    };

    // Fire-and-forget — client polls /status
    void runPipeline({
      platforms: body.platforms,
      maxApplications: body.maxApplications,
    });

    res.json({
      success: true,
      data: { message: "Pipeline started", state: getOrchestratorState() },
    });
  })
);

// POST /api/apply/stop
router.post(
  "/stop",
  asyncHandler(async (_req, res) => {
    stopPipeline();
    res.json({ success: true, data: { message: "Stop signal sent" } });
  })
);

// POST /api/apply/retry
router.post(
  "/retry",
  asyncHandler(async (_req, res) => {
    const state = getOrchestratorState();
    if (state.isRunning) {
      res.status(409).json({ success: false, error: "Pipeline already running" });
      return;
    }
    void retryFailed();
    res.json({ success: true, data: { message: "Retry started" } });
  })
);

// POST /api/apply/score — score pending jobs only (no apply)
router.post(
  "/score",
  asyncHandler(async (_req, res) => {
    void scoreAllPending();
    res.json({ success: true, data: { message: "Scoring started" } });
  })
);

// GET /api/apply/status
router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getOrchestratorState() });
  })
);

// GET /api/apply/applications — list all applications
router.get(
  "/applications",
  asyncHandler(async (req, res) => {
    const limitRaw = Array.isArray(req.query.limit) ? String(req.query.limit[0]) : req.query.limit as string | undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 100;
    const apps = await db.listApplications(limit);
    res.json({ success: true, data: apps });
  })
);

export { router as applyRouter };
