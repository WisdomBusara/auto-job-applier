# Deploying AutoApply AI — GitHub + Vercel

This guide gets the project live end-to-end:
Frontend → Vercel, Backend → Vercel, Database → Supabase.

---

## Architecture on Vercel

```
GitHub (source) → GitHub Actions (CI) → Vercel (deploy)

Browser → vercel.app/frontend (Next.js)
                │ fetch
                ▼
       vercel.app/backend (Express via @vercel/node)
                │
                ▼
         Supabase (PostgreSQL)
```

Playwright automation does NOT run on Vercel (serverless has no Chromium).
It runs only in Docker / local mode. The API returns 501 for browser-dependent
features when running serverlessly.

---

## Step 1 — Supabase (database)

1. Create a free project at **https://supabase.com**
2. Go to **SQL Editor** → paste the contents of `supabase/schema.sql` → Run
3. Go to **Project Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (not anon) → `SUPABASE_SERVICE_KEY`

---

## Step 2 — Push to GitHub

```bash
cd auto-job-applier
git init
git add .
git commit -m "Initial commit"
gh repo create auto-job-applier --private --source=. --push
# or: git remote add origin https://github.com/YOU/auto-job-applier.git && git push -u origin main
```

---

## Step 3 — Vercel Projects

Create **two separate** Vercel projects — one for the backend, one for the frontend.

### 3A — Backend project

1. Go to **https://vercel.com/new**
2. Import your GitHub repo
3. Set **Root Directory** to `backend`
4. **Framework Preset**: Other
5. **Build Command**: `npm run build`
6. **Output Directory**: `dist`
7. Add **Environment Variables**:
   ```
   SUPABASE_URL          = https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY  = eyJ...your service role key...
   GEMINI_API_KEY        = your_gemini_key_or_leave_blank
   OPENAI_API_KEY        = your_openai_key_or_leave_blank
   AI_MODE               = auto
   NODE_ENV              = production
   ```
8. Deploy → copy the deployment URL, e.g. `https://aja-backend.vercel.app`

### 3B — Frontend project

1. Go to **https://vercel.com/new** again
2. Import the same GitHub repo
3. Set **Root Directory** to `frontend`
4. **Framework Preset**: Next.js
5. **Install Command**: `npm install --legacy-peer-deps`
6. Add **Environment Variables**:
   ```
   NEXT_PUBLIC_API_URL = https://aja-backend.vercel.app
   ```
   (Use the exact backend URL from step 3A)
7. Deploy → your app is live at `https://aja-frontend.vercel.app`

---

## Step 4 — GitHub Actions Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | From https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | From `.vercel/project.json` after running `vercel link` in the repo |
| `VERCEL_BACKEND_PROJECT_ID` | From `.vercel/project.json` in the `backend/` directory |
| `VERCEL_FRONTEND_PROJECT_ID` | From `.vercel/project.json` in the `frontend/` directory |
| `NEXT_PUBLIC_API_URL` | Your backend Vercel URL |

To get the project IDs:
```bash
cd backend && npx vercel link    # creates backend/.vercel/project.json
cd ../frontend && npx vercel link # creates frontend/.vercel/project.json
```

After this, every push to `main` automatically runs CI and deploys both services.

---

## Step 5 — Verify

```bash
# Backend health check
curl https://aja-backend.vercel.app/health
# → {"ok":true,"ts":"...","env":"production"}

# System info (AI provider)
curl https://aja-backend.vercel.app/api/system/info
# → {"success":true,"data":{"aiMode":"auto","activeProvider":"gemini",...}}

# Open the dashboard
open https://aja-frontend.vercel.app
```

---

## Custom domain (optional)

In Vercel dashboard → your frontend project → **Settings → Domains** → add your domain.

---

## Limitations on Vercel

| Feature | Vercel | Docker |
|---|---|---|
| AI job scoring | ✅ | ✅ |
| AI cover letters | ✅ | ✅ |
| Local keyword engine | ✅ | ✅ |
| CV upload + parse | ✅ | ✅ |
| Dashboard / UI | ✅ | ✅ |
| LinkedIn automation | ❌ (no Chromium) | ✅ |
| Indeed automation | ❌ (no Chromium) | ✅ |
| Greenhouse (JSON API) | ✅ (no browser needed) | ✅ |
| SQLite | ❌ (no persistent disk) | ✅ |
| Supabase | ✅ | ✅ |

**For browser automation**: use Docker (see README.md).

---

## Environment variable summary

### Backend (Vercel or Docker)
```env
AI_MODE=auto                    # local | gemini | openai | auto
GEMINI_API_KEY=                 # optional
OPENAI_API_KEY=                 # optional
SUPABASE_URL=                   # required on Vercel
SUPABASE_SERVICE_KEY=           # required on Vercel
PORT=4000
NODE_ENV=production
LOG_LEVEL=info
FRONTEND_URL=https://your-frontend.vercel.app
DATA_DIR=/app/data              # Docker only
```

### Frontend (Vercel or Docker)
```env
NEXT_PUBLIC_API_URL=https://your-backend.vercel.app
```
