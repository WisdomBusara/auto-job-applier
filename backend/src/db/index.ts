/**
 * db/index.ts — selects MongoDB, Supabase, or SQLite at startup.
 *
 * MongoDB:        MONGODB_URL set      → MongoDB
 * Supabase:       SUPABASE_URL set     → Supabase
 * Local / Docker: neither set          → SQLite
 */

import type { DbAdapter } from "./adapter.js";

// ─── MongoDB ──────────────────────────────────────────────────────────────────

import mongoDbAdapter from "./mongodb-adapter.js";

// ─── SQLite (synchronous, local/Docker) ───────────────────────────────────────

import { sqliteDb } from "./sqlite-db.js";

// ─── Supabase (async, cloud) ──────────────────────────────────────────────────

import { supabaseAdapter } from "./supabase-adapter.js";

// ─── Export the right adapter ─────────────────────────────────────────────────

export const db: DbAdapter = process.env.MONGODB_URL
  ? mongoDbAdapter
  : process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? supabaseAdapter
    : sqliteDb;
