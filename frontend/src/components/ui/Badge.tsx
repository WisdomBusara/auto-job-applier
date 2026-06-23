import type { ReactNode } from "react";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral" | "purple";

const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  error:   "bg-rose-50 text-rose-700 border-rose-200",
  info:    "bg-indigo-50 text-indigo-700 border-indigo-200",
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  purple:  "bg-violet-50 text-violet-700 border-violet-200",
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
}

export default function Badge({ children, variant = "neutral", dot }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${VARIANTS[variant]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// Helpers for status → variant
export function jobStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "success": return "success";
    case "running": return "info";
    case "failed":  return "error";
    case "skipped": return "warning";
    default:        return "neutral";
  }
}

export function appStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "applied":          return "success";
    case "interview":        return "purple";
    case "offer":            return "success";
    case "rejected":         return "error";
    case "failed":           return "error";
    case "ready_to_submit":  return "warning";
    default:                 return "neutral";
  }
}

export function logLevelVariant(level: string): BadgeVariant {
  switch (level) {
    case "success": return "success";
    case "warn":    return "warning";
    case "error":   return "error";
    case "info":    return "info";
    default:        return "neutral";
  }
}
