"use client";
import type { OrchestratorState } from "@/types";

interface PipelineControlProps {
  state: OrchestratorState;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onScoreOnly: () => void;
  error: string | null;
}

const phaseLabel: Record<string, string> = {
  idle:      "Idle",
  searching: "Searching jobs…",
  matching:  "AI scoring…",
  applying:  "Applying…",
  done:      "Complete",
};

export default function PipelineControl({
  state,
  onStart,
  onStop,
  onRetry,
  onScoreOnly,
  error,
}: PipelineControlProps) {
  const phase = phaseLabel[state.phase] ?? state.phase;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Status */}
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${state.isRunning ? "bg-indigo-50 animate-pulse" : "bg-slate-50"}`}>
            {state.isRunning ? "⚙️" : "🚀"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${state.isRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              <p className="font-bold text-slate-900 text-sm">
                {state.isRunning ? phase : "Pipeline Ready"}
              </p>
            </div>
            {state.isRunning && (
              <p className="text-slate-400 text-xs mt-0.5">
                Processed: {state.processed} · Applied: {state.applied} · Skipped: {state.skipped} · Failed: {state.failed}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {!state.isRunning ? (
            <>
              <button
                onClick={onStart}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all shadow-sm shadow-indigo-600/20 active:scale-95"
              >
                🛰️ Auto Apply
              </button>
              <button
                onClick={onScoreOnly}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all"
              >
                🧠 Score Only
              </button>
              <button
                onClick={onRetry}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all"
              >
                🔄 Retry Failed
              </button>
            </>
          ) : (
            <button
              onClick={onStop}
              className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-sm transition-all active:scale-95"
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-medium">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
