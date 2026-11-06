import type { Db } from "../db.js";
import type { CurveState } from "../bonding/curve.js";
import { nowIso } from "../lib/ids.js";

export type StoredCurve = CurveState & {
  mint: string;
  symbol: string | null;
  name: string | null;
  progressPct: number;
  updatedAt: string;
  graduated: boolean;
};

export function ensureCurveTable(db: Db) {
  db.exec(`
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
  `);
}

export function upsertCurve(
  db: Db,
  mint: string,
  state: CurveState,
  meta: { symbol?: string; name?: string; progressPct: number; graduated?: boolean },
) {
  ensureCurveTable(db);
  db.prepare(
    `INSERT INTO curve_state (mint, symbol, name, virtual_sol, virtual_token, real_sol, real_token, complete, progress_pct, graduated, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET
       symbol = COALESCE(excluded.symbol, curve_state.symbol),
       name = COALESCE(excluded.name, curve_state.name),
       virtual_sol = excluded.virtual_sol,
       virtual_token = excluded.virtual_token,
       real_sol = excluded.real_sol,
       real_token = excluded.real_token,
       complete = excluded.complete,
       progress_pct = excluded.progress_pct,
       graduated = excluded.graduated,
       updated_at = excluded.updated_at`,
  ).run(
    mint,
    meta.symbol ?? null,
    meta.name ?? null,
    state.virtualSolReserves.toString(),
    state.virtualTokenReserves.toString(),
    state.realSolReserves.toString(),
    state.realTokenReserves.toString(),
    state.complete ? 1 : 0,
    meta.progressPct,
    meta.graduated || state.complete ? 1 : 0,
    nowIso(),
  );
}

export function getCurve(db: Db, mint: string): StoredCurve | null {
  ensureCurveTable(db);
  const row = db.prepare(`SELECT * FROM curve_state WHERE mint = ?`).get(mint) as any;
  if (!row) return null;
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    virtualSolReserves: BigInt(row.virtual_sol),
    virtualTokenReserves: BigInt(row.virtual_token),
    realSolReserves: BigInt(row.real_sol),
    realTokenReserves: BigInt(row.real_token),
    complete: !!row.complete,
    progressPct: row.progress_pct,
    updatedAt: row.updated_at,
    graduated: !!row.graduated,
  };
}

export function listAboutToGraduate(db: Db, minPct: number, limit = 50): StoredCurve[] {
  ensureCurveTable(db);
  const rows = db
    .prepare(
      `SELECT * FROM curve_state WHERE graduated = 0 AND complete = 0 AND progress_pct >= ? ORDER BY progress_pct DESC LIMIT ?`,
    )
    .all(minPct, limit) as any[];
  return rows.map((row) => ({
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    virtualSolReserves: BigInt(row.virtual_sol),
    virtualTokenReserves: BigInt(row.virtual_token),
    realSolReserves: BigInt(row.real_sol),
    realTokenReserves: BigInt(row.real_token),
    complete: !!row.complete,
    progressPct: row.progress_pct,
    updatedAt: row.updated_at,
    graduated: !!row.graduated,
  }));
}

export function listNewBonding(db: Db, limit = 50): StoredCurve[] {
  ensureCurveTable(db);
  const rows = db
    .prepare(`SELECT * FROM curve_state WHERE graduated = 0 ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as any[];
  return rows.map((row) => ({
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    virtualSolReserves: BigInt(row.virtual_sol),
    virtualTokenReserves: BigInt(row.virtual_token),
    realSolReserves: BigInt(row.real_sol),
    realTokenReserves: BigInt(row.real_token),
    complete: !!row.complete,
    progressPct: row.progress_pct,
    updatedAt: row.updated_at,
    graduated: !!row.graduated,
  }));
}

export function markGraduated(db: Db, mint: string, symbol?: string, name?: string) {
  ensureCurveTable(db);
  const existing = getCurve(db, mint);
  if (existing) {
    upsertCurve(db, mint, existing, {
      symbol: symbol ?? existing.symbol ?? undefined,
      name: name ?? existing.name ?? undefined,
      progressPct: 100,
      graduated: true,
    });
  } else {
    db.prepare(
      `INSERT INTO curve_state (mint, symbol, name, virtual_sol, virtual_token, real_sol, real_token, complete, progress_pct, graduated, updated_at)
       VALUES (?, ?, ?, '0', '0', '0', '0', 1, 100, 1, ?)
       ON CONFLICT(mint) DO UPDATE SET graduated = 1, complete = 1, progress_pct = 100, updated_at = excluded.updated_at`,
    ).run(mint, symbol ?? null, name ?? null, nowIso());
  }
}

export function upsertFeedCoin(db: Db, mint: string, kind: string, payload: unknown, symbol?: string, name?: string) {
  ensureCurveTable(db);
  db.prepare(
    `INSERT INTO feed_coins (mint, kind, symbol, name, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, symbol = COALESCE(excluded.symbol, feed_coins.symbol), name = COALESCE(excluded.name, feed_coins.name), updated_at = excluded.updated_at`,
  ).run(mint, kind, symbol ?? null, name ?? null, JSON.stringify(payload), nowIso());
}

export function listFeedCoins(db: Db, kind: string, limit = 50): any[] {
  ensureCurveTable(db);
  const rows = db.prepare(`SELECT payload FROM feed_coins WHERE kind = ? ORDER BY updated_at DESC LIMIT ?`).all(kind, limit) as any[];
  return rows.map((r) => JSON.parse(r.payload));
}
