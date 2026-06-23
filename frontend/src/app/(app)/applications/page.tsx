"use client";
import { useEffect, useState, useCallback, type MouseEvent } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Badge, { appStatusVariant } from "@/components/ui/Badge";
import ScoreRing from "@/components/ui/ScoreRing";
import { applyApi } from "@/lib/api";
import type { Application, ApplicationStatus } from "@/types";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  planned:         "Planned",
  ready_to_submit: "Ready to Submit",
  applied:         "Applied",
  follow_up_1:     "Follow-up 1",
  follow_up_2:     "Follow-up 2",
  interview:       "Interview",
  offer:           "Offer",
  rejected:        "Rejected",
  failed:          "Failed",
};

export default function ApplicationsPage() {
  const [apps, setApps]         = useState<Application[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<Application | null>(null);

  const fetchApps = useCallback(async () => {
    try {
      const data = await applyApi.applications(200);
      setApps(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApps();
    const interval = setInterval(() => void fetchApps(), 10000);
    return () => clearInterval(interval);
  }, [fetchApps]);

  // Summary counts
  const counts = apps.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  const avgScore =
    apps.length > 0
      ? Math.round(apps.reduce((s, a) => s + a.matchScore, 0) / apps.length)
      : 0;

  return (
    <div className="p-8 animate-fade-in">
      <PageHeader
        title="Application Tracker"
        subtitle={`${apps.length} total applications`}
      />

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        {(["applied", "interview", "offer", "rejected", "ready_to_submit", "failed"] as ApplicationStatus[]).map(
          (s) => (
            <div key={s} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-black text-slate-900">{counts[s] ?? 0}</p>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1 leading-tight">
                {STATUS_LABELS[s]}
              </p>
            </div>
          )
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <span className="text-6xl mb-4">📋</span>
          <h3 className="text-xl font-black text-slate-700 mb-2">No Applications Yet</h3>
          <p className="text-slate-400 max-w-sm">
            Run the Auto Apply pipeline from the Dashboard or Job Queue to start tracking applications.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-widest">
            <span>Position</span>
            <span>Status</span>
            <span>Score</span>
            <span>Prediction</span>
            <span>Applied</span>
            <span>Pack</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-50">
            {apps.map((app) => (
              <div
                key={app.id}
                className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-4 px-6 py-4 items-center hover:bg-indigo-50/30 transition-colors group"
              >
                {/* Position */}
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate group-hover:text-indigo-700 transition-colors">
                    {app.jobTitle}
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5 truncate">{app.company}</p>
                </div>

                {/* Status */}
                <div>
                  <Badge variant={appStatusVariant(app.status)}>
                    {STATUS_LABELS[app.status] ?? app.status}
                  </Badge>
                  {app.errorMessage && (
                    <p className="text-rose-500 text-[10px] mt-1 truncate max-w-[140px]" title={app.errorMessage}>
                      {app.errorMessage}
                    </p>
                  )}
                </div>

                {/* Score */}
                <div className="flex items-center gap-2">
                  <ScoreRing score={app.matchScore} size="sm" />
                </div>

                {/* Prediction */}
                <div>
                  {app.prediction ? (
                    <div>
                      <p className="text-xs font-bold text-slate-700 leading-tight truncate">{app.prediction}</p>
                      {app.confidence !== null && (
                        <div className="flex items-center gap-1 mt-1">
                          <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-400"
                              style={{ width: `${app.confidence}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">{app.confidence}%</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </div>

                {/* Applied date */}
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {app.appliedAt
                      ? new Date(app.appliedAt).toLocaleDateString()
                      : <span className="text-slate-300">—</span>}
                  </p>
                  <p className="text-[10px] text-slate-300 mt-0.5">
                    {new Date(app.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Pack action */}
                <div>
                  {app.pack ? (
                    <button
                      onClick={() => setSelected(app)}
                      className="px-3 py-1.5 text-[11px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-all"
                    >
                      View Pack
                    </button>
                  ) : (
                    <span className="text-slate-200 text-xs">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Average score footer */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              {apps.length} Applications · Avg Match Score
            </span>
            <span className="text-indigo-600 font-black text-lg">{avgScore}%</span>
          </div>
        </div>
      )}

      {/* Application Pack Drawer */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={(e: MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in">
            {/* Drawer header */}
            <div className="sticky top-0 bg-white px-6 py-5 border-b border-slate-100 flex items-start justify-between rounded-t-3xl">
              <div>
                <h2 className="font-black text-slate-900 text-lg">{selected.jobTitle}</h2>
                <p className="text-slate-400 text-sm">{selected.company}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-all font-bold"
              >
                ✕
              </button>
            </div>

            {/* Pack content */}
            {selected.pack && (
              <div className="p-6 space-y-6">
                {/* Cover Letter */}
                {selected.pack.coverLetter && (
                  <section>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Cover Letter</h3>
                    <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-line border border-slate-100">
                      {selected.pack.coverLetter}
                    </div>
                  </section>
                )}

                {/* Resume edits */}
                {selected.pack.resumeEdits && (
                  <section>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">CV Tailoring</h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      {selected.pack.resumeEdits.headline && (
                        <div>
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1">Headline</p>
                          <p className="text-sm font-bold text-slate-900">{selected.pack.resumeEdits.headline}</p>
                        </div>
                      )}
                      {selected.pack.resumeEdits.coreSkills?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide mb-2">Core Skills</p>
                          <div className="flex flex-wrap gap-2">
                            {selected.pack.resumeEdits.coreSkills.map((skill, i) => (
                              <span key={i} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-100">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Checklist */}
                {selected.pack.checklist?.length > 0 && (
                  <section>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Checklist</h3>
                    <ul className="space-y-2">
                      {selected.pack.checklist.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="text-emerald-500 mt-0.5 shrink-0">☐</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* ATS check */}
                {selected.pack.atsCheck && (
                  <section>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">ATS Check</h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{selected.pack.atsCheck.keywordsPresent ? "✅" : "⚠️"}</span>
                        <span className="text-sm font-bold text-slate-900">
                          Keywords {selected.pack.atsCheck.keywordsPresent ? "present" : "missing"}
                        </span>
                      </div>
                      {selected.pack.atsCheck.missingMustHaves?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {selected.pack.atsCheck.missingMustHaves.map((kw, i) => (
                            <span key={i} className="px-2 py-1 bg-rose-50 text-rose-700 rounded-lg text-xs font-bold border border-rose-100">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Follow-up schedule */}
                {selected.pack.followUpSchedule && (
                  <section>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Follow-up Schedule</h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-sm">
                      <p><span className="font-black text-slate-500">Follow-up 1:</span> <span className="text-slate-700">{selected.pack.followUpSchedule.date1}</span></p>
                      <p><span className="font-black text-slate-500">Follow-up 2:</span> <span className="text-slate-700">{selected.pack.followUpSchedule.date2}</span></p>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
