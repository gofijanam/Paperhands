import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";

export type Db = DatabaseSync;

export function openDb(config: Config): Db {
  const file = config.isMock || config.DATABASE_PATH === ":memory:" ? ":memory:" : config.DATABASE_PATH;
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      message TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hold_cache (
      wallet TEXT PRIMARY KEY,
      balance TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL,
      bankroll_sol TEXT NOT NULL,
      length_sec INTEGER NOT NULL,
      marks_json TEXT,
      successor_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_active ON cycles(status) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS portfolios (
      user_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      cash_sol TEXT NOT NULL,
      realized_pnl_sol TEXT NOT NULL DEFAULT '0',
      volume_sol TEXT NOT NULL DEFAULT '0',
      trade_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, cycle_id)
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      qty TEXT NOT NULL,
      avg_entry_sol TEXT NOT NULL,
      cost_sol TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      payload TEXT NOT NULL,
      idempotency_key TEXT,
      filled_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS trades_idem ON trades(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id TEXT NOT NULL,
      mint TEXT NOT NULL,
      PRIMARY KEY (user_id, mint)
    );
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      wallet TEXT NOT NULL,
      pnl_pct TEXT NOT NULL,
      amount_sol TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_ref TEXT,
      note TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coin_flags (
      mint TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reason TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS curve_state (
      mint TEXT PRIMARY KEY,
      symbol TEXT,
      name TEXT,
      virtual_sol TEXT NOT NULL,
      virtual_token TEXT NOT NULL,
      real_sol TEXT NOT NULL,
      real_token TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0,
      progress_pct REAL NOT NULL DEFAULT 0,
      graduated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_coins (
      mint TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE quotes ADD COLUMN used INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE cycles ADD COLUMN marks_json TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE cycles ADD COLUMN successor_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_active ON cycles(status) WHERE status = 'active'`);
  } catch {
    /* */
  }
}

