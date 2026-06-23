"use client";
import ScoreRing from "./ScoreRing";
import Badge, { jobStatusVariant } from "./Badge";
import type { Job } from "@/types";

interface JobCardProps {
  job: Job;
  onApply?: (job: Job) => void;
  isApplying?: boolean;
  key?: string; // React key — passed by parent map(), not used internally
}

const platformIcon: Record<string, string> = {
  linkedin:   "💼",
  indeed:     "🔵",
  greenhouse: "🌿",
};

export default function JobCard({ job, onApply, isApplying }: JobCardProps) {
  const predictionColor =
    job.prediction?.toLowerCase().includes("high") ? "text-emerald-600 bg-emerald-50 border-emerald-100" :
    job.prediction?.toLowerCase().includes("competitive") ? "text-indigo-600 bg-indigo-50 border-indigo-100" :
    job.prediction?.toLowerCase().includes("longshot") ? "text-amber-600 bg-amber-50 border-amber-100" :
    "text-slate-500 bg-slate-50 border-slate-100";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-lg hover:border-indigo-200 transition-all duration-200 flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-base">{platformIcon[job.platform] ?? "🏢"}</span>
            <Badge variant="neutral">{job.platform}</Badge>
            {job.remote && <Badge variant="info">Remote</Badge>}
            <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
          </div>
          <h3 className="font-bold text-slate-900 text-base leading-tight line-clamp-2">
            {job.title}
          </h3>
          <p className="text-slate-500 text-sm mt-0.5">
            {job.company} {job.location ? `· ${job.location}` : ""}
          </p>
        </div>
        <div className="shrink-0">
          <ScoreRing score={job.matchScore} size="md" />
        </div>
      </div>

      {/* Prediction */}
      {job.prediction && (
        <div className={`mb-3 px-3 py-2 rounded-xl border text-xs ${predictionColor}`}>
          <div className="flex justify-between items-center mb-0.5">
            <span className="font-black uppercase tracking-tight">AI Forecast</span>
            {job.confidence !== null && (
              <span className="opacity-60">{job.confidence}% confidence</span>
            )}
          </div>
          <p className="font-bold truncate">{job.prediction}</p>
          {job.confidence !== null && (
            <div className="mt-1.5 w-full bg-black/5 h-1 rounded-full overflow-hidden">
              <div className="h-full bg-current opacity-30" style={{ width: `${job.confidence}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Match justification bullets */}
      {job.matchJustification.length > 0 && (
        <ul className="space-y-1 mb-3">
          {job.matchJustification.slice(0, 3).map((j, i) => (
            <li key={i} className="flex gap-2 text-xs text-slate-600">
              <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
              <span className="line-clamp-1">{j}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Description snippet */}
      <p className="text-slate-400 text-xs line-clamp-2 italic flex-1 mb-4">
        {job.description ? `"${job.description.slice(0, 120)}..."` : "No description available."}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <div>
          {job.salary && <p className="text-indigo-600 font-bold text-sm">{job.salary}</p>}
          {job.seniority && <p className="text-slate-400 text-[11px] uppercase tracking-wide">{job.seniority}</p>}
        </div>
        <div className="flex items-center gap-2">
          {job.url && job.url !== "#" && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-indigo-600 transition-colors text-xs font-semibold"
            >
              View →
            </a>
          )}
          {onApply && (
            <button
              onClick={() => onApply(job)}
              disabled={isApplying || job.status === "success"}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                job.status === "success"
                  ? "bg-emerald-50 text-emerald-600 cursor-default"
                  : isApplying
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-sm shadow-indigo-600/20"
              }`}
            >
              {job.status === "success" ? "Applied ✓" : isApplying ? "Applying…" : "Auto-Apply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
