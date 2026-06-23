import winston from "winston";
import fs from "fs";

if (!fs.existsSync("logs")) fs.mkdirSync("logs", { recursive: true });
if (!fs.existsSync("logs/screenshots")) fs.mkdirSync("logs/screenshots", { recursive: true });

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Real @types/winston types TransformableInfo.message as `unknown` — cast explicitly
const logFormat = printf((info) => {
  const msg   = typeof info.message === "string" ? info.message : String(info.message);
  const stack = typeof info.stack   === "string" ? info.stack   : undefined;
  const ts    = typeof info.timestamp === "string" ? info.timestamp : "";
  return `${ts} [${info.level}]: ${stack ?? msg}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    colorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});
