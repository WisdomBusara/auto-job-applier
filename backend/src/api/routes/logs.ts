import { Router } from "express";
import { db } from "../../db/index.js";
import { asyncHandler } from "../middleware/error.js";

const logsRouter         = Router();
const integrationsRouter = Router();

logsRouter.get("/", asyncHandler(async (req, res) => {
  const limitRaw = Array.isArray(req.query.limit) ? String(req.query.limit[0]) : req.query.limit as string | undefined;
  const limit    = limitRaw ? parseInt(limitRaw, 10) : 200;
  res.json({ success: true, data: await db.listLogs(limit) });
}));

logsRouter.delete("/", asyncHandler(async (_req, res) => {
  await db.clearLogs();
  res.json({ success: true, data: { message: "Logs cleared" } });
}));

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await db.listIntegrations() });
}));

integrationsRouter.patch("/:platform", asyncHandler(async (req, res) => {
  const { platform } = req.params;
  const { enabled, config } = req.body as { enabled?: boolean; config?: Record<string, unknown> };
  const existing = await db.getIntegration(platform);
  if (!existing) { res.status(404).json({ success: false, error: `Integration "${platform}" not found` }); return; }
  await db.updateIntegration(platform, enabled ?? existing.enabled, config ?? existing.config);
  res.json({ success: true, data: await db.getIntegration(platform) });
}));

export { logsRouter, integrationsRouter };
