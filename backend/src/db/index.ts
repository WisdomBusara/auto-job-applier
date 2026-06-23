/**
 * db/index.ts — selects SQLite or Supabase at startup.
 *
 * Local / Docker:  SUPABASE_URL not set → SQLite
 * Vercel / Cloud:  SUPABASE_URL set     → Supabase
 */

import type { DbAdapter } from "./adapter.js";

// ─── SQLite (synchronous, local/Docker) ───────────────────────────────────────

import { sqliteDb } from "./sqlite-db.js";

// ─── Supabase (async, cloud) ──────────────────────────────────────────────────

import { supabaseAdapter } from "./supabase-adapter.js";

// ─── Export the right adapter ─────────────────────────────────────────────────

export const db: DbAdapter =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? supabaseAdapter
    : sqliteDb;
