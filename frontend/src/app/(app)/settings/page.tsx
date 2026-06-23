"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { userApi } from "@/lib/api";
import type { User, UserProfile, ExperienceLevel, RemotePreference } from "@/types";

export default function SettingsPage() {
  const [user, setUser]           = useState<User | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [cvPaste, setCvPaste]     = useState("");
  const [pasting, setPasting]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);
  const [form, setForm]           = useState<Partial<UserProfile & { email: string }>>({});

  const fetchUser = useCallback(async () => {
    try {
      const u = await userApi.get();
      setUser(u);
      setForm({
        email:                 u.email,
        fullName:              u.profile.fullName,
        phone:                 u.profile.phone,
        baseResume:            u.profile.baseResume,
        targetTitles:          u.profile.targetTitles,
        targetLocations:       u.profile.targetLocations,
        targetIndustries:      u.profile.targetIndustries,
        excludeKeywords:       u.profile.excludeKeywords,
        remotePreference:      u.profile.remotePreference,
        experienceLevel:       u.profile.experienceLevel,
        minSalary:             u.profile.minSalary,
        workAuthorization:     u.profile.workAuthorization,
        noticePeriod:          u.profile.noticePeriod,
        preferEasyApply:       u.profile.preferEasyApply,
        automationMode:        u.profile.automationMode,
        minMatchScore:         u.profile.minMatchScore,
        maxApplicationsPerDay: u.profile.maxApplicationsPerDay,
        links:                 u.profile.links,
        credentials: {
          linkedinEmail:    u.profile.credentials.linkedinEmail    === "***" ? "" : (u.profile.credentials.linkedinEmail    ?? ""),
          linkedinPassword: "",
          indeedEmail:      u.profile.credentials.indeedEmail      === "***" ? "" : (u.profile.credentials.indeedEmail      ?? ""),
          indeedPassword:   "",
        },
      });
    } catch {
      setError("Failed to load user settings");
    }
  }, []);

  useEffect(() => { void fetchUser(); }, [fetchUser]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const creds: UserProfile["credentials"] = {};
      if (form.credentials?.linkedinEmail)    creds.linkedinEmail    = form.credentials.linkedinEmail;
      if (form.credentials?.linkedinPassword) creds.linkedinPassword = form.credentials.linkedinPassword;
      if (form.credentials?.indeedEmail)      creds.indeedEmail      = form.credentials.indeedEmail;
      if (form.credentials?.indeedPassword)   creds.indeedPassword   = form.credentials.indeedPassword;
      await userApi.update({ ...form, credentials: creds });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await userApi.uploadCV(file);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handlePasteCV = async () => {
    if (!cvPaste.trim()) return;
    setPasting(true);
    setError(null);
    try {
      await userApi.pasteCV(cvPaste);
      setCvPaste("");
      setPasteMode(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paste failed");
    } finally {
      setPasting(false);
    }
  };

  const arrField = (key: keyof UserProfile) =>
    ((form[key] as string[] | undefined) ?? []).join(", ");

  const setArr = (key: keyof UserProfile, val: string) =>
    setForm((f) => ({ ...f, [key]: val.split(",").map((s) => s.trim()).filter(Boolean) }));

  if (!user) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Loading settings…
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Configure your profile, CV, and automation preferences"
        actions={
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm ${
              saved ? "bg-emerald-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20"
            } disabled:opacity-50`}
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Changes"}
          </button>
        }
      />

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {/* ── CV Upload ────────────────────────────────────────────────────────── */}
      <Section title="CV / Resume" icon="📄">
        <div className="space-y-4">
          {user.cvFilename && (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
              <span className="text-emerald-600 text-xl">✅</span>
              <div>
                <p className="font-bold text-emerald-800 text-sm">{user.cvFilename}</p>
                <p className="text-emerald-600 text-xs mt-0.5">
                  {user.cvText ? `${user.cvText.length.toLocaleString()} chars extracted` : "Uploaded"}
                </p>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50"
            >
              {uploading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Parsing…</> : <><span>📤</span> Upload PDF / TXT</>}
            </button>
            <button onClick={() => setPasteMode((v) => !v)} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all">
              ✏️ Paste Text
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.doc,.docx" onChange={handleFileUpload} className="hidden" />
          {pasteMode && (
            <div className="space-y-3">
              <textarea value={cvPaste} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCvPaste(e.target.value)}
                placeholder="Paste your CV / resume text here (min 50 chars)…" rows={8}
                className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 focus:border-indigo-400 rounded-xl text-sm font-mono outline-none resize-y transition-colors"
              />
              <div className="flex gap-2">
                <button onClick={handlePasteCV} disabled={pasting || cvPaste.trim().length < 50}
                  className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50">
                  {pasting ? "Parsing…" : "Parse & Save"}
                </button>
                <button onClick={() => { setPasteMode(false); setCvPaste(""); }}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Identity ─────────────────────────────────────────────────────────── */}
      <Section title="Identity" icon="👤">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full Name">
            <input value={form.fullName ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls} placeholder="Your Name" />
          </Field>
          <Field label="Email">
            <input value={form.email ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputCls} placeholder="you@email.com" type="email" />
          </Field>
          <Field label="Phone">
            <input value={form.phone ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls} placeholder="+1 234 567 8900" />
          </Field>
          <Field label="Work Authorization">
            <input value={form.workAuthorization ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, workAuthorization: e.target.value }))}
              className={inputCls} placeholder="e.g. US Citizen" />
          </Field>
          <Field label="Notice Period">
            <input value={form.noticePeriod ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, noticePeriod: e.target.value }))}
              className={inputCls} placeholder="e.g. Immediate" />
          </Field>
          <Field label="Experience Level">
            <select value={form.experienceLevel ?? "Mid"} onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, experienceLevel: e.target.value as ExperienceLevel }))}
              className={inputCls}>
              {["Junior", "Mid", "Senior", "Lead"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {/* ── Job Preferences ───────────────────────────────────────────────────── */}
      <Section title="Job Preferences" icon="🎯">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Target Job Titles (comma separated)">
            <input value={arrField("targetTitles")} onChange={(e: ChangeEvent<HTMLInputElement>) => setArr("targetTitles", e.target.value)}
              className={inputCls} placeholder="Software Engineer, Full Stack Developer" />
          </Field>
          <Field label="Target Locations (comma separated)">
            <input value={arrField("targetLocations")} onChange={(e: ChangeEvent<HTMLInputElement>) => setArr("targetLocations", e.target.value)}
              className={inputCls} placeholder="Remote, New York" />
          </Field>
          <Field label="Target Industries (comma separated)">
            <input value={arrField("targetIndustries")} onChange={(e: ChangeEvent<HTMLInputElement>) => setArr("targetIndustries", e.target.value)}
              className={inputCls} placeholder="AI, SaaS, Fintech" />
          </Field>
          <Field label="Exclude Keywords (comma separated)">
            <input value={arrField("excludeKeywords")} onChange={(e: ChangeEvent<HTMLInputElement>) => setArr("excludeKeywords", e.target.value)}
              className={inputCls} placeholder="Legacy, jQuery" />
          </Field>
          <Field label="Remote Preference">
            <select value={form.remotePreference ?? "Remote"} onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, remotePreference: e.target.value as RemotePreference }))}
              className={inputCls}>
              {["Remote", "Hybrid", "On-site", "Flexible"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Min Salary (USD/yr)">
            <input value={form.minSalary ?? 0} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, minSalary: parseInt(e.target.value) || 0 }))}
              className={inputCls} type="number" placeholder="80000" />
          </Field>
        </div>
      </Section>

      {/* ── Automation ────────────────────────────────────────────────────────── */}
      <Section title="Automation" icon="⚙️">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Min Match Score to Apply (0–100)">
            <input value={form.minMatchScore ?? 65} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, minMatchScore: parseInt(e.target.value) || 65 }))}
              className={inputCls} type="number" min={0} max={100} />
          </Field>
          <Field label="Max Applications Per Day">
            <input value={form.maxApplicationsPerDay ?? 20} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, maxApplicationsPerDay: parseInt(e.target.value) || 20 }))}
              className={inputCls} type="number" min={1} max={100} />
          </Field>
        </div>
        <div className="space-y-3">
          <Toggle
            label="Autonomous Submission"
            description="Bot will automatically submit applications when match score exceeds your threshold."
            value={form.automationMode ?? false}
            onChange={(v) => setForm((f) => ({ ...f, automationMode: v }))}
            highlight
          />
          <Toggle
            label="Prefer Easy Apply"
            description="Prioritise one-click apply options (LinkedIn Easy Apply, Indeed Instant Apply)."
            value={form.preferEasyApply ?? true}
            onChange={(v) => setForm((f) => ({ ...f, preferEasyApply: v }))}
          />
        </div>
      </Section>

      {/* ── Platform Credentials ──────────────────────────────────────────────── */}
      <Section title="Platform Credentials" icon="🔐">
        <p className="text-slate-400 text-xs mb-4">Stored locally in SQLite. Never sent to third parties. Leave blank to keep existing values.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="LinkedIn Email">
            <input value={form.credentials?.linkedinEmail ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, credentials: { ...f.credentials, linkedinEmail: e.target.value } }))}
              className={inputCls} type="email" placeholder="your@email.com" />
          </Field>
          <Field label="LinkedIn Password">
            <input value={form.credentials?.linkedinPassword ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, credentials: { ...f.credentials, linkedinPassword: e.target.value } }))}
              className={inputCls} type="password" placeholder="••••••••" />
          </Field>
          <Field label="Indeed Email">
            <input value={form.credentials?.indeedEmail ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, credentials: { ...f.credentials, indeedEmail: e.target.value } }))}
              className={inputCls} type="email" placeholder="your@email.com" />
          </Field>
          <Field label="Indeed Password">
            <input value={form.credentials?.indeedPassword ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, credentials: { ...f.credentials, indeedPassword: e.target.value } }))}
              className={inputCls} type="password" placeholder="••••••••" />
          </Field>
        </div>
      </Section>

      {/* ── Links ─────────────────────────────────────────────────────────────── */}
      <Section title="Links" icon="🔗">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="LinkedIn URL">
            <input value={form.links?.linkedin ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, links: { ...f.links, linkedin: e.target.value } }))}
              className={inputCls} placeholder="https://linkedin.com/in/…" />
          </Field>
          <Field label="Portfolio URL">
            <input value={form.links?.portfolio ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, links: { ...f.links, portfolio: e.target.value } }))}
              className={inputCls} placeholder="https://yoursite.com" />
          </Field>
          <Field label="GitHub URL">
            <input value={form.links?.github ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, links: { ...f.links, github: e.target.value } }))}
              className={inputCls} placeholder="https://github.com/…" />
          </Field>
        </div>
      </Section>

      <div className="flex justify-end pt-4">
        <button onClick={handleSave} disabled={saving}
          className={`px-6 py-3 rounded-xl font-bold transition-all shadow-sm ${
            saved ? "bg-emerald-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20"
          } disabled:opacity-50`}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-400 rounded-xl text-sm font-medium outline-none transition-colors";

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black text-slate-900 mb-5">
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, description, value, onChange, highlight }: {
  label: string; description: string; value: boolean;
  onChange: (v: boolean) => void; highlight?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
      highlight && value ? "bg-indigo-50 border-indigo-100" : "bg-slate-50 border-slate-100"
    }`}>
      <div className="max-w-xs">
        <p className="font-bold text-slate-900 text-sm">{label}</p>
        <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ml-4 ${value ? "bg-indigo-600" : "bg-slate-300"}`}>
        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-6" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
