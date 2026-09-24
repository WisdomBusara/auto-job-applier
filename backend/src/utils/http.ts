/**
 * utils/http.ts
 *
 * One HTTP client for every outbound job-board request.
 *
 * Boards tolerate a single user browsing and throttle quickly past that. The
 * behaviour that keeps us inside their limits is the same behaviour that makes
 * runs fast and quiet: few requests in flight, a real pause between requests to
 * the same host, backing off when told to, and not re-downloading a board that
 * has not changed.
 *
 *   - bounded concurrency, so a long ATS_BOARDS list cannot fan out
 *   - a minimum gap between requests to the same host
 *   - exponential backoff with jitter on 429 and 5xx, honouring Retry-After
 *   - conditional GET via ETag / Last-Modified, so unchanged boards cost one
 *     304 instead of a full payload
 */

import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { logger } from "./logger.js";

const DEFAULT_TIMEOUT = 20_000;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Minimum spacing between two requests to the same host. */
const MIN_HOST_GAP_MS = Number(process.env.HTTP_MIN_HOST_GAP_MS ?? "700");
/** How many requests may be in flight across all hosts. */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.HTTP_CONCURRENCY ?? "3"));

const client = axios.create({
  timeout: DEFAULT_TIMEOUT,
  // We decide what counts as a failure; a 304 and a 429 are both useful.
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    "Accept-Encoding": "gzip, deflate",
  },
});

// ─── Per-host pacing ──────────────────────────────────────────────────────────

const lastRequestAt = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function pace(host: string): Promise<void> {
  const last = lastRequestAt.get(host);
  const now = Date.now();
  if (last !== undefined) {
    const wait = last + MIN_HOST_GAP_MS - now;
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(host, Date.now());
}

// ─── Concurrency gate ─────────────────────────────────────────────────────────

let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Run a mapper over items with the same concurrency ceiling the HTTP client
 * uses, so callers do not have to reach for Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });

  await Promise.all(workers);
  return results;
}

// ─── Conditional-request cache ────────────────────────────────────────────────

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  data: unknown;
  storedAt: number;
}

/**
 * Keyed by URL. In-process only: the scheduler runs in the same long-lived
 * backend, so this survives between runs but not across a restart, which is
 * the right trade for something that is purely an optimisation.
 */
const cache = new Map<string, CacheEntry>();

export function clearHttpCache(): void {
  cache.clear();
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

function retryAfterMs(res: AxiosResponse): number | null {
  const raw = res.headers?.["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  const date = Date.parse(String(raw));
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS);
  return null;
}

function backoffMs(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter: without it, parallel workers retry in lockstep and hit the
  // same limit again together.
  return Math.random() * exponential;
}

/** Statuses worth retrying. A 4xx other than 429 will not change on a retry. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

export interface GetResult<T = unknown> {
  status: number;
  data: T;
  /** True when the server answered 304 and `data` came from cache. */
  fromCache: boolean;
  /** Where the request actually landed after redirects. */
  finalUrl: string;
}

function landedAt(res: AxiosResponse, requested: string): string {
  const viaNode = (res.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl;
  return String(viaNode ?? res.request?.responseURL ?? requested);
}

/**
 * GET with pacing, bounded concurrency, conditional revalidation and backoff.
 *
 * Returns the last response rather than throwing on a non-2xx, so callers can
 * log a board that is temporarily unavailable and carry on with the others.
 */
export async function getJson<T = unknown>(
  url: string,
  config: AxiosRequestConfig = {}
): Promise<GetResult<T>> {
  const host = hostOf(url);
  const cached = cache.get(url);

  await acquire();
  try {
    let lastStatus = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await pace(host);

      const headers: Record<string, string> = { ...(config.headers as Record<string, string>) };
      if (cached?.etag) headers["If-None-Match"] = cached.etag;
      if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

      const res = await client.get(url, { ...config, headers });
      lastStatus = res.status;

      if (res.status === 304 && cached) {
        logger.debug(`[http] 304 ${url} — using cached copy`);
        return { status: 304, data: cached.data as T, fromCache: true, finalUrl: url };
      }

      if (isRetryable(res.status)) {
        const wait = retryAfterMs(res) ?? backoffMs(attempt);
        if (attempt === MAX_ATTEMPTS - 1) {
          logger.warn(`[http] ${res.status} ${url} — giving up after ${MAX_ATTEMPTS} attempts`);
          return { status: res.status, data: res.data as T, fromCache: false, finalUrl: landedAt(res, url) };
        }
        logger.warn(
          `[http] ${res.status} ${url} — backing off ${Math.round(wait)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`
        );
        await sleep(wait);
        continue;
      }

      if (res.status >= 200 && res.status < 300) {
        const etag = res.headers?.["etag"] as string | undefined;
        const lastModified = res.headers?.["last-modified"] as string | undefined;
        if (etag || lastModified) {
          cache.set(url, { etag, lastModified, data: res.data, storedAt: Date.now() });
        }
      }

      return { status: res.status, data: res.data as T, fromCache: false, finalUrl: landedAt(res, url) };
    }

    return { status: lastStatus, data: undefined as T, fromCache: false, finalUrl: url };
  } catch (err) {
    logger.warn(`[http] ${url} failed: ${String(err)}`);
    return { status: 0, data: undefined as T, fromCache: false, finalUrl: url };
  } finally {
    release();
  }
}

export const httpLimits = {
  concurrency: MAX_CONCURRENCY,
  minHostGapMs: MIN_HOST_GAP_MS,
  maxAttempts: MAX_ATTEMPTS,
};
