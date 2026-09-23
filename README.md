# AutoApply AI 🤖

**Automated job application platform.** Find jobs, score them against your CV, auto-fill forms, track everything.

Works **with or without AI API keys**:

| Mode | What you need | What you get |
|---|---|---|
| **Local** (offline) | Nothing | Keyword-based scoring, template cover letters, sample job listings |
| **Gemini** | Free Gemini API key | AI job search, deep CV matching, tailored cover letters |
| **OpenAI** | OpenAI API key | Same as Gemini |
| **Auto** (default) | Optional keys | Uses best available; falls back gracefully to local |

---

## Table of Contents

1. [Quick Start — Docker (recommended)](#1-quick-start--docker)
2. [Quick Start — Local Dev (no Docker)](#2-quick-start--local-dev)
3. [AI Mode Configuration](#3-ai-mode-configuration)
4. [Environment Variables](#4-environment-variables)
5. [Project Structure](#5-project-structure)
6. [Architecture](#6-architecture)
7. [API Reference](#7-api-reference)
8. [Adding a New Job Platform](#8-adding-a-new-job-platform)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Quick Start — Docker

Docker is the recommended way to run AutoApply. It handles all dependencies, Chromium, and configuration automatically.

### Option A — No API keys (fully offline)

```bash
git clone <repo-url>
cd auto-job-applier

# No .env needed — local mode requires zero configuration
docker compose -f docker-compose.local.yml up --build
```

Open **http://localhost:3000**. The system uses a built-in keyword engine to score jobs.

---

### Option B — With Gemini API key (recommended for best results)

```bash
git clone <repo-url>
cd auto-job-applier

cp .env.example .env
```

Edit `.env`:
```env
AI_MODE=auto
GEMINI_API_KEY=your_gemini_api_key_here
```

Get a free Gemini key at [aistudio.google.com](https://aistudio.google.com) → "Get API key".

```bash
docker compose up --build
```

Open **http://localhost:3000**.

---

### Option C — With OpenAI API key

```bash
cp .env.example .env
```

Edit `.env`:
```env
AI_MODE=openai
OPENAI_API_KEY=sk-...your-key...
```

```bash
docker compose up --build
```

---

### Docker commands reference

```bash
# Start (detached)
docker compose up -d --build

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop
docker compose down

# Stop and wipe all data
docker compose down -v

# Rebuild after code changes
docker compose up --build

# Local mode (no keys)
docker compose -f docker-compose.local.yml up --build
```

---

## 1.5 Quick Start — Docker with MongoDB (VPS)

If you have MongoDB running on a VPS, this is the recommended setup.

```bash
git clone <repo-url>
cd auto-job-applier

cp .env.example .env
```

Edit `.env`:
```env
AI_MODE=auto
GEMINI_API_KEY=your_gemini_api_key_here

# MongoDB connection string
MONGODB_URL=mongodb://user:password@your-vps-ip:27017/auto-job-applier
# Or with MongoDB Atlas:
# MONGODB_URL=mongodb+srv://user:password@cluster.mongodb.net/auto-job-applier

# Optional: restrict CORS to your VPS domain
FRONTEND_URL=https://your-vps-domain.com
```

```bash
docker compose up --build
```

Open **https://your-vps-domain.com:3000** (or **http://your-vps-ip:3000** for development).

---

## 2. Quick Start — Local Dev

Run the backend and frontend directly on your machine (no Docker).

### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org)
- **npm 10+** — bundled with Node.js
- (Optional) Chromium, for Playwright automation

### Backend

```bash
cd auto-job-applier/backend

# Install dependencies
npm install

# Configure environment
cp ../.env.example .env
# Edit .env — set AI_MODE and optionally GEMINI_API_KEY

# Build TypeScript → dist/
npm run build

# Start the API server (port 4000)
npm start
```

For **development with auto-reload**:
```bash
# Terminal 1: watch-compile TypeScript
npm run dev

# Terminal 2: run compiled output
node --watch dist/index.js
```

### Frontend

```bash
cd auto-job-applier/frontend

# Install dependencies
npm install

# Start Next.js dev server (port 3000)
npm run dev
```

For **production frontend build**:
```bash
npm run build
npm start
```

### Running without any keys (local dev)

```bash
# backend/.env
AI_MODE=local
PORT=4000
NODE_ENV=development
DATA_DIR=./data
```

No other variables needed. The system is fully functional with keyword-based matching.

---

## 3. AI Mode Configuration

Set `AI_MODE` in your `.env` or Docker environment:

### `AI_MODE=local` — Offline / No keys

- **Job search**: generates realistic sample listings based on your target titles
- **Scoring**: keyword overlap between your CV and job description (0–100)
- **Cover letters**: professional template filled with your profile data
- **CV parsing**: regex-based name/email/title extraction
- **Best for**: testing, privacy-conscious use, no internet required

### `AI_MODE=gemini` — Google Gemini (recommended)

- Requires `GEMINI_API_KEY`
- Uses `gemini-2.0-flash` for all operations
- Get a **free** key: [aistudio.google.com](https://aistudio.google.com)
- Free tier: 1,500 requests/day, 15 RPM

### `AI_MODE=openai` — OpenAI GPT-4o-mini

- Requires `OPENAI_API_KEY`
- Uses `gpt-4o-mini` for all operations
- Paid service; ~$0.15 per 1M input tokens

### `AI_MODE=auto` (default)

Priority order: **Gemini → OpenAI → Local**

- If `GEMINI_API_KEY` is set: uses Gemini
- Else if `OPENAI_API_KEY` is set: uses OpenAI
- Else: uses local keyword engine
- If an API call fails: automatically falls back to the next available provider

```
┌─────────────────────────────────────────────────────────┐
│                    AI_MODE=auto                          │
│                                                         │
│  GEMINI_API_KEY set? ──yes──▶ Use Gemini                │
│         │                         │ fails?             │
│         no                        ▼                    │
│         │              OPENAI_API_KEY set? ──yes──▶ Use OpenAI │
│         │                              │ fails?        │
│         ▼                              ▼               │
│  OPENAI_API_KEY set? ──yes──▶ Use OpenAI    ▼          │
│         │ no                    Use Local Engine       │
│         ▼                                              │
│   Use Local Engine                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Environment Variables

### Backend variables (`.env` or Docker environment)

| Variable | Default | Description |
|---|---|---|
| `AI_MODE` | `auto` | `local` \| `gemini` \| `openai` \| `auto` |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `PORT` | `4000` | Backend HTTP port |
| `NODE_ENV` | `production` | `development` \| `production` |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `MONGODB_URL` | — | MongoDB connection string (uses MongoDB if set) |
| `SUPABASE_URL` | — | Supabase URL (uses Supabase if MONGODB_URL not set) |
| `SUPABASE_SERVICE_KEY` | — | Supabase service key |
| `DATA_DIR` | `./data` | SQLite database directory (used if MongoDB/Supabase not set) |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin |

### Frontend variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | URL the **browser** uses to reach the backend |

> ⚠️ `NEXT_PUBLIC_API_URL` is baked into the Next.js bundle **at build time**. If you change it, rebuild the frontend container.

---

## 5. Project Structure

```
auto-job-applier/
│
├── .env.example                  ← copy to .env
├── Dockerfile                    ← 4-stage multi-stage build
├── docker-compose.yml            ← with AI keys
├── docker-compose.local.yml      ← no AI keys required
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json             ← NodeNext, strict
│   └── src/
│       ├── types/index.ts        ← all domain types
│       ├── db/
│       │   ├── index.ts          ← adapter selector (MongoDB > Supabase > SQLite)
│       │   ├── mongodb-adapter.ts ← MongoDB (async, VPS)
│       │   ├── sqlite-db.ts      ← SQLite (sync, local)
│       │   ├── supabase-adapter.ts ← Supabase (async, cloud)
│       │   └── adapter.ts        ← interface
│       ├── utils/logger.ts       ← Winston
│       │
│       ├── ai/
│       │   ├── service.ts        ← unified entry point, mode detection
│       │   └── local-engine.ts   ← self-contained keyword engine
│       │
│       ├── automation/
│       │   ├── platform.interface.ts
│       │   ├── browser.base.ts   ← Playwright helpers
│       │   ├── linkedin.ts       ← Easy Apply
│       │   ├── indeed.ts         ← Instant Apply
│       │   └── greenhouse.ts     ← JSON API (10 companies)
│       │
│       ├── orchestrator/index.ts ← pipeline brain
│       │
│       ├── api/
│       │   ├── middleware/error.ts
│       │   └── routes/
│       │       ├── jobs.ts
│       │       ├── apply.ts      ← start/stop/retry/score
│       │       ├── user.ts       ← profile + CV upload
│       │       └── logs.ts       ← logs + integrations
│       │
│       └── index.ts              ← Express server
│
└── frontend/
    └── src/
        ├── types/index.ts        ← mirrors backend types
        ├── lib/api.ts            ← typed fetch client
        ├── hooks/usePipeline.ts  ← polling hook
        ├── app/
        │   ├── layout.tsx
        │   ├── globals.css
        │   └── (app)/
        │       ├── layout.tsx    ← shell + sidebar
        │       ├── dashboard/    ← funnel chart, stats, live log
        │       ├── jobs/         ← job queue, filters, apply
        │       ├── applications/ ← tracker + pack drawer
        │       ├── logs/         ← live console
        │       ├── settings/     ← profile, CV upload, credentials
        │       └── integrations/ ← toggle platforms
        └── components/
            ├── layout/           ← Sidebar, PageHeader
            └── ui/               ← JobCard, BotConsole, ScoreRing, …
```

---

## 6. Architecture

```
Browser (:3000)
    │
    │  REST API (fetch)
    ▼
Express Backend (:4000)
    │
    ├─ ai/service.ts ──────────────────────────────────────
    │    │                                                │
    │    ├─ AI_MODE=local ──▶ local-engine.ts             │
    │    │    keyword scoring, template cover letters     │
    │    │    sample job generation, regex CV parse       │
    │    │                                                │
    │    ├─ AI_MODE=gemini ─▶ @google/genai               │
    │    │    gemini-2.0-flash for all AI operations      │
    │    │                                                │
    │    └─ AI_MODE=openai ─▶ openai                      │
    │         gpt-4o-mini for all AI operations           │
    │                                                ─────┘
    ├─ orchestrator/
    │    discover jobs → score → apply → log
    │
    ├─ automation/ (Playwright)
    │    linkedin.ts, indeed.ts, greenhouse.ts
    │
    └─ db/ (MongoDB, Supabase, or SQLite)
         users, jobs, applications, logs, integrations
```

---

## 7. API Reference

### Health

| `GET /health` | Returns `{ ok: true, ts, env }` |

### User

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/user` | Get profile (credentials masked) |
| `PATCH` | `/api/user` | Update profile fields |
| `POST` | `/api/user/cv` | Upload CV file (PDF/TXT, multipart) |
| `POST` | `/api/user/cv/text` | Paste CV as plain text |

### Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/jobs` | List jobs (`?status=pending&platform=linkedin&limit=100`) |
| `GET` | `/api/jobs/stats` | Pipeline statistics |
| `GET` | `/api/jobs/:id` | Get single job |
| `DELETE` | `/api/jobs/:id` | Delete job |
| `DELETE` | `/api/jobs` | Clear all jobs |

### Pipeline

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/apply/start` | `{ useAISearch?, platforms?, maxApplications? }` | Start full pipeline |
| `POST` | `/api/apply/stop` | — | Stop running pipeline |
| `POST` | `/api/apply/retry` | — | Retry all failed jobs |
| `POST` | `/api/apply/score` | — | Score pending jobs only (no submit) |
| `GET` | `/api/apply/status` | — | Current orchestrator state |
| `GET` | `/api/apply/applications` | — | All application records |

### Logs & Integrations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/logs` | List log entries (`?limit=200`) |
| `DELETE` | `/api/logs` | Clear all logs |
| `GET` | `/api/integrations` | List integrations |
| `PATCH` | `/api/integrations/:platform` | `{ enabled, config }` |

---

## 8. Adding a New Job Platform

1. **Create** `backend/src/automation/myplatform.ts`:

```typescript
import { BrowserBase } from "./browser.base.js";
import type { JobPlatform, RawJob } from "./platform.interface.js";
import type { Job, UserProfile } from "../types/index.js";

export class MyPlatformIntegration extends BrowserBase implements JobPlatform {
  readonly name = "myplatform";
  protected platformName = "myplatform";

  async login(profile: UserProfile): Promise<void> {
    await this.launch(true);
    // implement login with this.humanType(), this.safeClick(), etc.
  }

  async searchJobs(profile: UserProfile): Promise<RawJob[]> {
    const page = this.requirePage();
    // scrape jobs, return RawJob[]
    return [];
  }

  async applyToJob(job: Job, coverLetter: string, cvPath: string): Promise<boolean> {
    // fill form, return true if submitted
    return false;
  }
}
```

2. **Register** in `backend/src/orchestrator/index.ts`:

```typescript
import { MyPlatformIntegration } from "../automation/myplatform.js";

const PLATFORM_REGISTRY: Record<string, () => JobPlatform> = {
  // existing...
  myplatform: () => new MyPlatformIntegration(),
};
```

3. **Seed** the integration in `backend/src/db/index.ts` → `seedDefaults()`:

```typescript
const platforms = ["linkedin", "indeed", "greenhouse", "myplatform"];
```

4. Rebuild: `npm run build` or `docker compose up --build`

---

## 9. Troubleshooting

### Backend won't start

```bash
# Check logs
docker compose logs backend

# Common cause: DATA_DIR not writable
docker compose down -v && docker compose up --build
```

### "AI matching unavailable" in logs

The AI provider failed or no keys are set. Either:
- Set `AI_MODE=local` to use keyword matching (always works)
- Check your API key is valid and has quota
- `docker compose logs backend | grep "\[ai\]"` — shows which provider is active

### Frontend shows "Failed to fetch"

The browser can't reach the backend. Check:
```bash
# Is backend healthy?
curl http://localhost:4000/health

# Was NEXT_PUBLIC_API_URL set correctly at BUILD TIME?
# If you changed it, rebuild:
docker compose up --build
```

### Playwright / LinkedIn fails

LinkedIn automation requires valid credentials and may hit bot-detection. Steps:
1. Add credentials in **Settings → Platform Credentials**
2. Enable LinkedIn in **Integrations**
3. Try **Score Only** first to verify scoring works without browser automation
4. LinkedIn may require solving a CAPTCHA on first login — this is expected

### Port already in use

```bash
# Change ports in docker-compose.yml:
ports:
  - "4001:4000"   # backend on 4001
  - "3001:3000"   # frontend on 3001
```

### Running on a remote server

1. Set `NEXT_PUBLIC_API_URL=https://your-server.com:4000` **before building**
2. Open firewall ports 3000 and 4000
3. Consider putting nginx in front for TLS

### MongoDB connection issues

**Can't connect to MongoDB:**

```bash
# Check MongoDB is running on your VPS
ssh user@vps-ip
mongosh  # or `mongo` for older versions

# If not running, start it
sudo systemctl start mongod

# Check service status
sudo systemctl status mongod
```

**Connection string examples:**

```env
# Local MongoDB (no auth):
MONGODB_URL=mongodb://localhost:27017/auto-job-applier

# VPS with authentication:
MONGODB_URL=mongodb://myuser:mypassword@192.168.1.100:27017/auto-job-applier

# MongoDB Atlas (cloud):
MONGODB_URL=mongodb+srv://user:password@cluster0.abc123.mongodb.net/auto-job-applier

# Add replica set if needed:
MONGODB_URL=mongodb://user:pass@host1:27017,host2:27017/auto-job-applier?replicaSet=rs0
```

**Check connection from backend:**

```bash
docker compose logs backend | grep "MongoDB"
# Should see: "MongoDB connected"
```

---

## Local Engine Details

When running without API keys (`AI_MODE=local`), the system uses a built-in scoring engine:

| Component | Algorithm |
|---|---|
| **Job scoring** | Jaccard keyword overlap (CV vs JD) + title match + location + seniority + industry |
| **Job search** | Generates 12 sample listings based on your target titles and locations |
| **Cover letters** | Template with your name, role, company, and experience level filled in |
| **CV parsing** | Regex extraction of email, phone, name; keyword detection for experience level |
| **Score range** | 0–100, same thresholds as AI mode (default: apply if ≥ 65) |

The local engine produces useful results immediately. Switch to an AI provider for deeper analysis and personalised cover letters.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22 · Express 4 · TypeScript (strict, NodeNext modules) |
| Database | SQLite (better-sqlite3) · optional Supabase |
| AI (online) | Google Gemini 2.0 Flash · OpenAI GPT-4o-mini |
| AI (offline) | Built-in keyword/TF-IDF engine — zero dependencies |
| Automation | Playwright · Chromium (headless) |
| Frontend | Next.js 15 · React 19 · Tailwind CSS 3 · Recharts |
| Containers | Docker multi-stage · Debian bookworm-slim |
