"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Badge, { logLevelVariant } from "@/components/ui/Badge";
import { logsApi } from "@/lib/api";
import type { LogEntry, LogLevel } from "@/types";

const LEVELS: Array<{ value: LogLevel | "all"; label: string }> = [
  { value: "all",     label: "All" },
  { value: "success", label: "Success" },
  { value: "info",    label: "Info" },
  { value: "warn",    label: "Warn" },
  { value: "error",   label: "Error" },
];

const levelDot: Record<string, string> = {
  success: "bg-emerald-500",
  info:    "bg-sky-500",
  warn:    "bg-amber-500",
  error:   "bg-rose-500",
  debug:   "bg-slate-400",
};

const levelColor: Record<string, string> = {
  success: "text-emerald-400",
  info:    "text-sky-400",
  warn:    "text-amber-400",
  error:   "text-rose-400",
  debug:   "text-slate-500",
};

export default function LogsPage() {
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [filter, setFilter]       = useState<LogLevel | "all">("all");
  const [autoScroll, setAuto]     = useState(true);
  const [clearing, setClearing]   = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await logsApi.list(300);
      // oldest-first for console display
      setLogs(data.slice().reverse());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchLogs();
    const interval = setInterval(() => void fetchLogs(), 3000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await logsApi.clear();
      setLogs([]);
    } finally {
      setClearing(false);
    }
  };

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="p-8 animate-fade-in flex flex-col" style={{ minHeight: "calc(100vh - 0px)" }}>
      <PageHeader
        title="Live Logs"
        subtitle="Real-time pipeline activity stream"
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setAuto((v) => !v)}
                className={`w-9 h-5 rounded-full transition-colors ${autoScroll ? "bg-indigo-600" : "bg-slate-200"} relative`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoScroll ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-xs font-bold text-slate-500">Auto-scroll</span>
            </label>
            <button
              onClick={handleClear}
              disabled={clearing || logs.length === 0}
              className="px-4 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-all disabled:opacity-40"
            >
              {clearing ? "Clearing…" : "Clear Logs"}
            </button>
          </div>
        }
      />

      {/* Level filter pills */}
      <div className="flex items-center gap-1 mb-4 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => setFilter(l.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === l.value
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            {l.label}
            {l.value !== "all" && (
              <span className="ml-1.5 text-[10px] opacity-60">
                ({logs.filter((lg) => lg.level === l.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Console */}
      <div className="flex-1 bg-slate-950 rounded-2xl border border-white/5 overflow-hidden flex flex-col">
        {/* Console top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/70" />
              <span className="w-3 h-3 rounded-full bg-amber-500/70" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
            </div>
            <span className="text-slate-500 text-xs font-mono font-bold ml-2 uppercase tracking-widest">
              system.log — {filtered.length} entries
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-emerald-500 text-[10px] font-mono uppercase">LIVE</span>
          </div>
        </div>

        {/* Log lines */}
        <div className="flex-1 overflow-y-auto p-4 space-y-0.5 font-mono text-xs" style={{ maxHeight: "calc(100vh - 280px)" }}>
          {filtered.length === 0 ? (
            <p className="text-slate-600 italic">No log entries. Start the pipeline to see output here.</p>
          ) : (
            filtered.map((log) => (
              <div key={log.id} className="flex gap-3 py-0.5 leading-5 group hover:bg-white/3 rounded px-1 transition-colors">
                {/* Timestamp */}
                <span className="text-slate-600 shrink-0 tabular-nums w-20">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>

                {/* Level dot */}
                <span className={`shrink-0 mt-2 w-1.5 h-1.5 rounded-full ${levelDot[log.level] ?? "bg-slate-500"}`} />

                {/* Level badge */}
                <span className={`shrink-0 w-14 font-black uppercase ${levelColor[log.level] ?? "text-slate-400"}`}>
                  {log.level}
                </span>

                {/* Message */}
                <span className={`break-all ${levelColor[log.level] ?? "text-slate-300"}`}>
                  {log.message}
                </span>

                {/* Job ID tag */}
                {log.jobId && (
                  <span className="ml-auto shrink-0 text-slate-600 text-[10px] font-mono pl-2">
                    {log.jobId.slice(0, 8)}
                  </span>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-4 mt-3 px-1">
        {(["success", "info", "warn", "error"] as LogLevel[]).map((level) => {
          const count = logs.filter((l) => l.level === level).length;
          return (
            <div key={level} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${levelDot[level]}`} />
              <span className="text-xs text-slate-400 font-medium capitalize">{level}: <strong className="text-slate-600">{count}</strong></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
