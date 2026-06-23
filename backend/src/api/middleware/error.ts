import type { Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger.js";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

// Four-argument signature is required by Express for error handlers
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const e = err as AppError;
  const status = e.statusCode ?? 500;
  const message = e.message ?? "Internal Server Error";
  logger.error(`[API Error] ${status} — ${message}`, { stack: e.stack });
  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" ? { stack: e.stack } : {}),
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: "Route not found" });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
