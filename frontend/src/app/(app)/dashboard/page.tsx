"use client";
import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Cell,
  Tooltip,
} from "recharts";
import PageHeader from "@/components/layout/PageHeader";
import StatCard from "@/components/ui/StatCard";
import BotConsole from "@/components/ui/BotConsole";
import PipelineControl from "@/components/ui/PipelineControl";
import { jobsApi, logsApi } from "@/lib/api";
import { usePipeline } from "@/hooks/usePipeline";
import type { OrchestratorStats, LogEntry } from "@/types";

const FUNNEL_COLORS = ["#94a3b8", "#fbbf24", "#6366f1", "#10b981", "#8b5cf6"];

export default function DashboardPage() {
  const { state, error, start, stop, retry, scoreOnly } = usePipeline();
  const [stats, setStats] = useState<OrchestratorStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([jobsApi.stats(), logsApi.list(100)]);
      setStats(s);
      setLogs(l.slice().reverse()); // oldest first for console
    } catch {
      // backend not yet ready
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), state.isRunning ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [fetchData, state.isRunning]);

  const funnelData = stats
    ? [
        { name: "Total",   value: stats.totalJobs,            fill: FUNNEL_COLORS[0] },
        { name: "Pending", value: stats.pending,              fill: FUNNEL_COLORS[1] },
        { name: "Scored",  value: stats.success + stats.skipped, fill: FUNNEL_COLORS[2] },
        { name: "Applied", value: stats.success,              fill: FUNNEL_COLORS[3] },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="p-8 animate-fade-in">
      <PageHeader
        title="Neural Pipeline"
        subtitle="Real-time job application intelligence dashboard"
      />

      {/* Pipeline control */}
      <div className="mb-6">
        <PipelineControl
          state={state}
          onStart={() => void start({ useAISearch: true })}
          onStop={() => void stop()}
          onRetry={() => void retry()}
          onScoreOnly={() => void scoreOnly()}
          error={error}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Jobs"        value={stats?.totalJobs ?? 0}         icon="📋" color="slate" />
        <StatCard label="Applied Today"     value={stats?.applicationsToday ?? 0} icon="✅" color="emerald" />
        <StatCard label="Pending"           value={stats?.pending ?? 0}           icon="⏳" color="amber" />
        <StatCard label="Failed"            value={stats?.failed ?? 0}            icon="❌" color="rose" />
      </div>

      {/* Funnel + mini stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Funnel chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h3 className="font-black text-slate-900 mb-1">Application Funnel</h3>
          <p className="text-slate-400 text-xs mb-4 uppercase tracking-wide">Jobs → Scored → Applied</p>
          {funnelData.length > 0 ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", fontWeight: 700 }}
                  />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="#64748b" stroke="none" dataKey="name" fontWeight={700} fontSize={12} />
                    {(funnelData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    )) as unknown as null)}
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center text-center">
              <span className="text-5xl mb-3">📡</span>
              <p className="text-slate-400 font-bold">No data yet</p>
              <p className="text-slate-300 text-sm mt-1">Click "Auto Apply" to start the pipeline</p>
            </div>
          )}
        </div>

        {/* Mini stats column */}
        <div className="space-y-4">
          <StatCard label="Running"  value={stats?.running ?? 0}  icon="⚙️" color="indigo" />
          <StatCard label="Success"  value={stats?.success ?? 0}  icon="🎯" color="emerald" />
          <StatCard label="Skipped"  value={stats?.skipped ?? 0}  icon="⏭️" color="amber" />
        </div>
      </div>

      {/* Live console */}
      <div>
        <h3 className="font-black text-slate-900 mb-3">Live Activity Log</h3>
        <BotConsole logs={logs} maxHeight="280px" />
      </div>
    </div>
  );
}
