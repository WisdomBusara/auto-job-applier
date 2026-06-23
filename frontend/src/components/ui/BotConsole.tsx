"use client";
import { useEffect, useRef } from "react";
import type { LogEntry } from "@/types";

interface BotConsoleProps {
  logs: LogEntry[];
  maxHeight?: string;
}

const levelColor: Record<string, string> = {
  success: "text-emerald-400",
  info:    "text-sky-400",
  warn:    "text-amber-400",
  error:   "text-rose-400",
  debug:   "text-slate-500",
};

const levelIcon: Record<string, string> = {
  success: "✓",
  info:    "›",
  warn:    "⚠",
  error:   "✗",
  debug:   "·",
};

export default function BotConsole({ logs, maxHeight = "320px" }: BotConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="bg-slate-950 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500/70" />
            <span className="w-3 h-3 rounded-full bg-amber-500/70" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
          </div>
          <span className="text-slate-500 text-xs font-mono font-bold ml-2 uppercase tracking-widest">
            Bot Activity Console
          </span>
        </div>
        <span className="animate-pulse w-2 h-2 bg-emerald-500 rounded-full" />
      </div>

      {/* Log lines */}
      <div
        className="overflow-y-auto p-4 space-y-0.5 font-mono text-xs"
        style={{ maxHeight }}
      >
        {logs.length === 0 ? (
          <p className="text-slate-600 italic">Waiting for bot initialization...</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 leading-5">
              <span className="text-slate-600 shrink-0 tabular-nums">
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 w-3 font-black ${levelColor[log.level] ?? "text-slate-400"}`}>
                {levelIcon[log.level] ?? "·"}
              </span>
              <span className={`${levelColor[log.level] ?? "text-slate-300"} break-all`}>
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
