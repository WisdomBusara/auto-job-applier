import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import { logger } from "./utils/logger.js";
import { jobsRouter } from "./api/routes/jobs.js";
import { applyRouter } from "./api/routes/apply.js";
import { userRouter } from "./api/routes/user.js";
import { logsRouter, integrationsRouter } from "./api/routes/logs.js";
import { errorHandler, notFound } from "./api/middleware/error.js";
import { getActiveProvider } from "./ai/service.js";
import { startScheduler } from "./scheduler/index.js";

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

const app = express();

// ─── Process-level safety net ─────────────────────────────────────────────────
// A stray rejection anywhere would otherwise terminate the process, dropping
// in-flight requests and restarting the container. Log it and keep serving.

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled promise rejection: ${String(reason)}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.stack ?? String(err)}`);
});

// ─── Core middleware ──────────────────────────────────────────────────────────

app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  }) as RequestHandler
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/jobs",         jobsRouter         as unknown as RequestHandler);
app.use("/api/apply",        applyRouter        as unknown as RequestHandler);
app.use("/api/user",         userRouter         as unknown as RequestHandler);
app.use("/api/logs",         logsRouter         as unknown as RequestHandler);
app.use("/api/integrations", integrationsRouter as unknown as RequestHandler);

// ─── System info ──────────────────────────────────────────────────────────────

app.get("/api/system/info", (_req: Request, res: Response) => {
  const provider = getActiveProvider();
  res.json({
    success: true,
    data: {
      aiMode:             process.env.AI_MODE ?? "auto",
      activeProvider:     provider,
      geminiConfigured:   Boolean(process.env.GEMINI_API_KEY),
      openaiConfigured:   Boolean(process.env.OPENAI_API_KEY),
      supabaseConfigured: Boolean(process.env.SUPABASE_URL),
      nodeEnv:            process.env.NODE_ENV ?? "development",
    },
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok:  true,
    ts:  new Date().toISOString(),
    env: process.env.NODE_ENV ?? "development",
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

app.use(notFound as RequestHandler);
app.use(errorHandler as unknown as RequestHandler);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  const provider = getActiveProvider();
  logger.info(`✅ Auto Job Applier backend running on http://0.0.0.0:${PORT}`);
  logger.info(`   AI Mode:  ${process.env.AI_MODE ?? "auto"} → provider: ${provider.toUpperCase()}`);
  logger.info(`   GEMINI:   ${process.env.GEMINI_API_KEY ? "✓ configured" : "not set"}`);
  logger.info(`   OPENAI:   ${process.env.OPENAI_API_KEY ? "✓ configured" : "not set"}`);
  logger.info(`   SUPABASE: ${process.env.SUPABASE_URL   ? "✓ configured" : "not set (using SQLite)"}`);
  if (provider === "local") {
    logger.info("   ⚡ Running in LOCAL mode — keyword engine active, no API calls");
  }

  startScheduler();
});

export default app;
