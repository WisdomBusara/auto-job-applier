# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Backend builder: install deps + compile TypeScript → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS backend-builder

WORKDIR /app/backend

COPY backend/package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Frontend builder: install deps + Next.js standalone build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json ./
# Use --legacy-peer-deps in case any transitive peer dep mismatch occurs
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY frontend/next.config.mjs frontend/tsconfig.json \
     frontend/tailwind.config.js frontend/postcss.config.js ./
COPY frontend/src ./src

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Backend runner: lean production image with Chromium for Playwright
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS backend

# Install Chromium and the libraries it actually needs on bookworm-slim.
# libasound2t64 was renamed/split across bookworm point releases — we skip it
# and let Chromium pull in what it actually needs via apt dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libvulkan1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY --from=backend-builder /app/backend/dist ./dist
COPY backend/package.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

RUN mkdir -p data logs/screenshots uploads data/sessions

EXPOSE 4000
CMD ["node", "dist/index.js"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 — Frontend runner: Next.js standalone
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend

WORKDIR /app

COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
# The builder stage never receives frontend/public (it is empty, so git does
# not track it) — COPYing it fails the build. Next only needs the directory to
# exist at runtime.
RUN mkdir -p public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
