import type {
  User,
  UserProfile,
  Job,
  Application,
  LogEntry,
  Integration,
  OrchestratorState,
  OrchestratorStats,
  ApiResponse,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.success || !res.ok) {
    throw new Error(json.error ?? `Request failed: ${res.status}`);
  }
  return json.data as T;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export const userApi = {
  get: () => request<User>("/api/user"),

  update: (patch: Partial<UserProfile & { email: string }>) =>
    request<User>("/api/user", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  uploadCV: async (file: File): Promise<{ filename: string; textLength: number; parsedProfile: Partial<UserProfile> }> => {
    const form = new FormData();
    form.append("cv", file);
    const res = await fetch(`${BASE}/api/user/cv`, { method: "POST", body: form });
    const json = (await res.json()) as ApiResponse<{ filename: string; textLength: number; parsedProfile: Partial<UserProfile> }>;
    if (!json.success) throw new Error(json.error ?? "Upload failed");
    return json.data!;
  },

  pasteCV: (text: string) =>
    request<{ textLength: number; parsedProfile: Partial<UserProfile> }>("/api/user/cv/text", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobsApi = {
  list: (params?: { status?: string; platform?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.platform) q.set("platform", params.platform);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<{ jobs: Job[]; stats: OrchestratorStats }>(`/api/jobs?${q}`);
  },

  stats: () => request<OrchestratorStats>("/api/jobs/stats"),

  get: (id: string) => request<Job>(`/api/jobs/${id}`),

  delete: (id: string) => request<{ deleted: string }>(`/api/jobs/${id}`, { method: "DELETE" }),

  clearAll: () => request<{ deleted: number }>("/api/jobs", { method: "DELETE" }),
};

// ─── Apply / Orchestrator ─────────────────────────────────────────────────────

export const applyApi = {
  start: (opts?: { platforms?: string[]; useAISearch?: boolean; maxApplications?: number }) =>
    request<{ message: string; state: OrchestratorState }>("/api/apply/start", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),

  stop: () =>
    request<{ message: string }>("/api/apply/stop", { method: "POST" }),

  retry: () =>
    request<{ message: string }>("/api/apply/retry", { method: "POST" }),

  score: () =>
    request<{ message: string }>("/api/apply/score", { method: "POST" }),

  status: () => request<OrchestratorState>("/api/apply/status"),

  applications: (limit = 100) =>
    request<Application[]>(`/api/apply/applications?limit=${limit}`),
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const logsApi = {
  list: (limit = 200) => request<LogEntry[]>(`/api/logs?limit=${limit}`),
  clear: () => request<{ message: string }>("/api/logs", { method: "DELETE" }),
};

// ─── Integrations ─────────────────────────────────────────────────────────────

export const integrationsApi = {
  list: () => request<Integration[]>("/api/integrations"),

  update: (platform: string, data: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<Integration>(`/api/integrations/${platform}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// ─── System ───────────────────────────────────────────────────────────────────

export const systemApi = {
  info: () => request<import("@/types").SystemInfo>("/api/system/info"),
};
