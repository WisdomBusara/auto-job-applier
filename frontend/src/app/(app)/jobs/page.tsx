"use client";
import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/layout/PageHeader";
import JobCard from "@/components/ui/JobCard";
import PipelineControl from "@/components/ui/PipelineControl";
import Badge from "@/components/ui/Badge";
import { jobsApi, applyApi } from "@/lib/api";
import { usePipeline } from "@/hooks/usePipeline";
import type { Job, JobStatus } from "@/types";

const STATUS_FILTERS: Array<{ label: string; value: JobStatus | "all" }> = [
  { label: "All",     value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Running", value: "running" },
  { label: "Applied", value: "success" },
  { label: "Failed",  value: "failed" },
  { label: "Skipped", value: "skipped" },
];

export default function JobsPage() {
  const { state, error, start, stop, retry, scoreOnly } = usePipeline();
  const [jobs, setJobs]                   = useState<Job[]>([]);
  const [filter, setFilter]               = useState<JobStatus | "all">("all");
  const [platform, setPlatform]           = useState<string>("all");
  const [applyingId, setApplyingId]       = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [clearing, setClearing]           = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const params: { status?: JobStatus; platform?: string } = {};
      if (filter !== "all") params.status = filter;
      if (platform !== "all") params.platform = platform;
      const res = await jobsApi.list({ ...params, limit: 200 });
      setJobs(res.jobs);
    } catch {
      // suppress
    } finally {
      setLoading(false);
    }
  }, [filter, platform]);

  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(() => void fetchJobs(), state.isRunning ? 3000 : 8000);
    return () => clearInterval(interval);
  }, [fetchJobs, state.isRunning]);

  const handleApply = async (job: Job) => {
    setApplyingId(job.id);
    try {
      await applyApi.start({ platforms: [job.platform], maxApplications: 1 });
      await fetchJobs();
    } catch {
      // ignore
    } finally {
      setApplyingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Delete all jobs? This cannot be undone.")) return;
    setClearing(true);
    try {
      await jobsApi.clearAll();
      setJobs([]);
    } finally {
      setClearing(false);
    }
  };

  const platforms = ["all", ...Array.from(new Set(jobs.map((j) => j.platform)))];

  return (
    <div className="p-8 animate-fade-in">
      <PageHeader
        title="Job Queue"
        subtitle={`${jobs.length} jobs found across all platforms`}
        actions={
          <button
            onClick={handleClearAll}
            disabled={clearing || jobs.length === 0}
            className="px-4 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-all disabled:opacity-40"
          >
            {clearing ? "Clearing…" : "Clear All"}
          </button>
        }
      />

      {/* Pipeline control */}
      <div className="mb-6">
        <PipelineControl
          state={state}
          onStart={() => void start()}
          onStop={() => void stop()}
          onRetry={() => void retry()}
          onScoreOnly={() => void scoreOnly()}
          error={error}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Status filter */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filter === f.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Platform filter */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                platform === p
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400 font-medium">
          {state.isRunning && (
            <span className="flex items-center gap-1.5 text-indigo-600 font-bold">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
              Pipeline running
            </span>
          )}
          <Badge variant="neutral">{`${jobs.length} jobs`}</Badge>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <span className="text-6xl mb-4">📡</span>
          <h3 className="text-xl font-black text-slate-700 mb-2">No Jobs Found</h3>
          <p className="text-slate-400 max-w-sm">
            Click <strong>Auto Apply</strong> to search jobs and start the pipeline, or adjust your filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onApply={handleApply}
              isApplying={applyingId === job.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
