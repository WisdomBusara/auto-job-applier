/**
 * scheduler/index.ts
 *
 * Runs the pipeline on an interval so the system works unattended.
 *
 * Off by default. Nothing here fires unless AUTO_RUN_INTERVAL_HOURS is set to
 * a positive number, because an accidental scheduler on a tool that submits
 * job applications is worse than no scheduler.
 *
 *   AUTO_RUN_INTERVAL_HOURS=6      run every 6 hours
 *   AUTO_RUN_QUIET_HOURS=22-7      skip runs between 22:00 and 07:00 local
 *   AUTO_RUN_ON_START=1            also run once shortly after boot
 *
 * The daily cap (profile.maxApplicationsPerDay) and the automationMode switch
 * still apply — this only decides when runPipeline is called, never whether an
 * application is allowed to be submitted.
 */

import { runPipeline, getOrchestratorState } from "../orchestrator/index.js";
import { logger } from "../utils/logger.js";

let timer: NodeJS.Timeout | null = null;

interface QuietWindow { start: number; end: number; }

function parseQuietHours(raw: string | undefined): QuietWindow | null {
  if (!raw) return null;
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(raw.trim());
  if (!m) {
    logger.warn(`[scheduler] Ignoring malformed AUTO_RUN_QUIET_HOURS="${raw}" (expected e.g. 22-7)`);
    return null;
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start > 23 || end > 23) {
    logger.warn(`[scheduler] Ignoring out-of-range AUTO_RUN_QUIET_HOURS="${raw}"`);
    return null;
  }
  return { start, end };
}

/** Quiet windows may wrap past midnight, e.g. 22-7. */
export function inQuietHours(window: QuietWindow | null, hour: number): boolean {
  if (!window) return false;
  const { start, end } = window;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

async function tick(quiet: QuietWindow | null): Promise<void> {
  const hour = new Date().getHours();
  if (inQuietHours(quiet, hour)) {
    logger.info(`[scheduler] Quiet hours (${hour}:00) — skipping this run`);
    return;
  }

  if (getOrchestratorState().isRunning) {
    logger.info("[scheduler] Previous run still in progress — skipping");
    return;
  }

  logger.info("[scheduler] Starting scheduled run");
  try {
    await runPipeline({});
  } catch (err) {
    logger.error(`[scheduler] Scheduled run failed: ${String(err)}`);
  }
}

export function startScheduler(): void {
  const hours = Number(process.env.AUTO_RUN_INTERVAL_HOURS ?? "0");
  if (!Number.isFinite(hours) || hours <= 0) {
    logger.info("[scheduler] Disabled (set AUTO_RUN_INTERVAL_HOURS to enable)");
    return;
  }

  const quiet = parseQuietHours(process.env.AUTO_RUN_QUIET_HOURS);
  const intervalMs = hours * 3600_000;

  timer = setInterval(() => void tick(quiet), intervalMs);
  // Do not hold the process open on account of the scheduler alone.
  timer.unref?.();

  logger.info(
    `[scheduler] Enabled — every ${hours}h` +
      (quiet ? `, quiet ${quiet.start}:00-${quiet.end}:00` : "")
  );

  if (process.env.AUTO_RUN_ON_START === "1") {
    // Delay so the server finishes binding and the DB is ready.
    setTimeout(() => void tick(quiet), 30_000).unref?.();
    logger.info("[scheduler] Will also run once 30s after start");
  }
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("[scheduler] Stopped");
  }
}
