"use client";
import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Badge from "@/components/ui/Badge";
import { integrationsApi, systemApi } from "@/lib/api";
import type { Integration, SystemInfo } from "@/types";

// ─── Platform metadata ────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, {
  icon: string; label: string; description: string; color: string; needsCredentials: boolean;
}> = {
  linkedin: {
    icon: "💼", label: "LinkedIn",
    description: "Auto-apply via LinkedIn Easy Apply. Requires LinkedIn credentials in Settings → Platform Credentials.",
    color: "bg-blue-50 border-blue-200", needsCredentials: true,
  },
  indeed: {
    icon: "🔵", label: "Indeed",
    description: "Search and apply via Indeed Instant Apply. Requires Indeed credentials in Settings → Platform Credentials.",
    color: "bg-indigo-50 border-indigo-200", needsCredentials: true,
  },
  greenhouse: {
    icon: "🌿", label: "Greenhouse",
    description: "Scan 10+ pre-configured company boards via the public Greenhouse JSON API. No login required.",
    color: "bg-emerald-50 border-emerald-200", needsCredentials: false,
  },
};

// ─── AI Provider metadata ─────────────────────────────────────────────────────

const AI_PROVIDER_META: Record<string, {
  icon: string; label: string; color: string; badge: string;
  description: string; setupUrl?: string; setupLabel?: string;
}> = {
  gemini: {
    icon: "✨", label: "Google Gemini",
    color: "bg-violet-50 border-violet-200",
    badge: "Active",
    description: "Using gemini-2.0-flash for job matching, cover letters, CV parsing, and job search simulation.",
    setupUrl: "https://aistudio.google.com", setupLabel: "Get free API key",
  },
  openai: {
    icon: "🤖", label: "OpenAI GPT-4o-mini",
    color: "bg-emerald-50 border-emerald-200",
    badge: "Active",
    description: "Using gpt-4o-mini for job matching, cover letters, CV parsing, and job search simulation.",
    setupUrl: "https://platform.openai.com/api-keys", setupLabel: "Get API key",
  },
  local: {
    icon: "⚡", label: "Local Engine (no API)",
    color: "bg-amber-50 border-amber-200",
    badge: "Offline mode",
    description: "Built-in keyword matcher — no internet required. Scores jobs via CV overlap, generates template cover letters, creates sample job listings based on your target titles.",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [systemInfo, setSystemInfo]     = useState<SystemInfo | null>(null);
  const [saving, setSaving]             = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [ints, info] = await Promise.all([
        integrationsApi.list(),
        systemApi.info(),
      ]);
      setIntegrations(ints);
      setSystemInfo(info);
    } catch {
      setError("Failed to load integrations");
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const togglePlatform = async (integration: Integration) => {
    setSaving(integration.platform);
    setError(null);
    try {
      await integrationsApi.update(integration.platform, { enabled: !integration.enabled });
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  };

  const enabledCount = integrations.filter((i) => i.enabled).length;
  const provider = systemInfo?.activeProvider ?? "local";
  const providerMeta = AI_PROVIDER_META[provider] ?? AI_PROVIDER_META.local!;

  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <PageHeader
        title="Integrations"
        subtitle={`${enabledCount} job platform${enabledCount !== 1 ? "s" : ""} enabled`}
      />

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {/* ── AI Provider Status ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
          AI Engine
        </h2>

        <div className={`rounded-2xl border p-6 ${providerMeta.color}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-2xl shrink-0">
                {providerMeta.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-black text-slate-900">{providerMeta.label}</h3>
                  <Badge variant={provider === "local" ? "warning" : "success"} dot>
                    {providerMeta.badge}
                  </Badge>
                  {systemInfo && (
                    <span className="text-[11px] font-mono text-slate-400">
                      AI_MODE={systemInfo.aiMode}
                    </span>
                  )}
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">{providerMeta.description}</p>

                {/* Key status row */}
                {systemInfo && (
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <KeyPill
                      label="Gemini"
                      configured={systemInfo.geminiConfigured}
                      active={provider === "gemini"}
                    />
                    <KeyPill
                      label="OpenAI"
                      configured={systemInfo.openaiConfigured}
                      active={provider === "openai"}
                    />
                    <KeyPill
                      label="Local"
                      configured={true}
                      active={provider === "local"}
                      alwaysAvailable
                    />
                  </div>
                )}
              </div>
            </div>

            {providerMeta.setupUrl && (
              <a
                href={providerMeta.setupUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs font-bold text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline"
              >
                {providerMeta.setupLabel} →
              </a>
            )}
          </div>

          {/* How to change provider */}
          {provider === "local" && (
            <div className="mt-4 p-3 bg-white/60 rounded-xl border border-amber-200 text-xs text-amber-800 leading-relaxed">
              <strong>To enable AI:</strong> set <code className="font-mono bg-amber-100 px-1 rounded">GEMINI_API_KEY</code> in your <code className="font-mono bg-amber-100 px-1 rounded">.env</code> file and restart.
              Get a free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="font-bold underline">aistudio.google.com</a>.
            </div>
          )}
        </div>
      </section>

      {/* ── Job Platforms ──────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
          Job Platforms
        </h2>

        <div className="space-y-4">
          {integrations.map((integration) => {
            const meta = PLATFORM_META[integration.platform] ?? {
              icon: "🔌", label: integration.platform,
              description: "External job platform integration.",
              color: "bg-slate-50 border-slate-200", needsCredentials: false,
            };
            const isSaving = saving === integration.platform;

            return (
              <div
                key={integration.id}
                className={`rounded-2xl border p-6 transition-all ${
                  integration.enabled ? meta.color : "bg-white border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${
                      integration.enabled ? "bg-white shadow-sm" : "bg-slate-100"
                    }`}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-black text-slate-900">{meta.label}</h3>
                        <Badge variant={integration.enabled ? "success" : "neutral"} dot>
                          {integration.enabled ? "Active" : "Disabled"}
                        </Badge>
                        {meta.needsCredentials && (
                          <Badge variant="neutral">Credentials required</Badge>
                        )}
                      </div>
                      <p className="text-slate-500 text-sm leading-relaxed">{meta.description}</p>
                      {integration.lastUsed && (
                        <p className="text-slate-400 text-xs mt-2 font-medium">
                          Last used: {new Date(integration.lastUsed).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => void togglePlatform(integration)}
                    disabled={isSaving}
                    className={`shrink-0 w-14 h-7 rounded-full relative transition-colors ${
                      integration.enabled ? "bg-indigo-600" : "bg-slate-300"
                    } disabled:opacity-50`}
                  >
                    {isSaving ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        integration.enabled ? "translate-x-8" : "translate-x-1"
                      }`} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Setup guide ────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 rounded-2xl p-6 text-white">
        <h3 className="font-black mb-4 text-lg">Setup Guide</h3>
        <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
          <Step n={1} title="Choose your AI mode">
            Set <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs">AI_MODE</code> in{" "}
            <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs">.env</code>:
            <ul className="mt-2 space-y-1 ml-4 text-slate-400 text-xs">
              <li><code className="text-amber-400">local</code> — no keys, works offline, keyword scoring</li>
              <li><code className="text-violet-400">gemini</code> — free key from aistudio.google.com</li>
              <li><code className="text-emerald-400">openai</code> — paid key from platform.openai.com</li>
              <li><code className="text-slate-300">auto</code> — tries Gemini → OpenAI → local (default)</li>
            </ul>
          </Step>
          <Step n={2} title="Enable job platforms">
            Toggle platforms above. <strong className="text-white">Greenhouse</strong> works with no credentials.
          </Step>
          <Step n={3} title="Add platform credentials (optional)">
            For LinkedIn and Indeed automation, add credentials in{" "}
            <strong className="text-white">Settings → Platform Credentials</strong>.
          </Step>
          <Step n={4} title="Run the pipeline">
            Go to <strong className="text-white">Dashboard</strong> and click{" "}
            <strong className="text-white">Auto Apply</strong>.
          </Step>
        </div>
      </div>

      {/* ── Developer note ─────────────────────────────────────────────────── */}
      <div className="mt-5 p-5 bg-amber-50 border border-amber-100 rounded-2xl">
        <h4 className="font-black text-amber-900 mb-2">⚡ Adding New Platforms</h4>
        <p className="text-amber-800 text-sm leading-relaxed">
          Implement the{" "}
          <code className="bg-amber-100 px-1 rounded font-mono text-xs">JobPlatform</code>{" "}
          interface in{" "}
          <code className="bg-amber-100 px-1 rounded font-mono text-xs">backend/src/automation/</code>{" "}
          and register in the orchestrator. See README for a full example.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KeyPill({ label, configured, active, alwaysAvailable }: {
  label: string; configured: boolean; active: boolean; alwaysAvailable?: boolean;
}) {
  const bg   = active ? "bg-indigo-600 text-white" : configured || alwaysAvailable ? "bg-white border border-slate-200 text-slate-600" : "bg-slate-100 text-slate-300";
  const dot  = active ? "bg-white" : configured || alwaysAvailable ? "bg-emerald-500" : "bg-slate-300";
  const text = active ? `${label} ← active` : configured || alwaysAvailable ? label : `${label} (not set)`;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-indigo-400 font-black shrink-0 w-4">{n}.</span>
      <div>
        <strong className="text-white">{title}</strong>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}
