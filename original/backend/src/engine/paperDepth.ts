/**
 * Net paper bonding-depth budget (R1 → netting for gameplay).
 *
 * Totals are derived from the `trades` table at check time (no in-memory Map):
 *   buys  = Σ bonding buy  inAmount  (SOL spent)
 *   sells = Σ bonding sell outAmount (SOL received)
 * Net extraction (sells − buys) is capped at current realSolReserves.
 * Scoped per user+mint+cycle so a restart cannot drop credit while the DB remains.
 *
 * Live mode: requirePriorBuys — refuse sells with zero buy credit.
 * Mock seeded / no-buy farming still hits the reserve cap (F2 / R1).
 */
import type { Db } from "../db.js";
import { solToLamports, lamportsToSol } from "../lib/money.js";

export type DepthTotals = { buys: bigint; sells: bigint };

function lamportsFromPayload(side: string, payload: string): bigint {
  try {
    const parsed = JSON.parse(payload) as { trade?: Record<string, unknown> } & Record<string, unknown>;
    const t = (parsed.trade ?? parsed) as {
      venue?: string;
      inAmount?: string;
      outAmount?: string;
    };
    if (t.venue && t.venue !== "bonding") return 0n;
    if (side === "buy" && t.inAmount != null) return solToLamports(String(t.inAmount));
    if (side === "sell" && t.outAmount != null) return solToLamports(String(t.outAmount));
  } catch {
    /* ignore corrupt row */
  }
  return 0n;
}

/** Sum bonding buy/sell SOL lamports for user+mint (optionally one cycle). */
export function paperDepthTotals(
  db: Db,
  userId: string,
  mint: string,
  cycleId?: string | null,
): DepthTotals {
  const rows = (
    cycleId
      ? db
          .prepare(`SELECT side, payload FROM trades WHERE user_id = ? AND mint = ? AND cycle_id = ?`)
          .all(userId, mint, cycleId)
      : db.prepare(`SELECT side, payload FROM trades WHERE user_id = ? AND mint = ?`).all(userId, mint)
  ) as { side: string; payload: string }[];

  let buys = 0n;
  let sells = 0n;
  for (const r of rows) {
    const amt = lamportsFromPayload(r.side, r.payload);
    if (amt <= 0n) continue;
    if (r.side === "buy") buys += amt;
    else if (r.side === "sell") sells += amt;
  }
  return { buys, sells };
}

/**
 * Pure check against trades-derived totals + this sell's proceeds.
 * Does not mutate state — the fill path records the sell in `trades`.
 */
export function tryConsumePaperDepth(opts: {
  db: Db;
  userId: string;
  mint: string;
  cycleId?: string | null;
  realSolReserves: bigint;
  amountLamports: bigint;
  /** Live ranked: refuse sells with no prior paper-cash buy credit for this mint. */
  requirePriorBuys?: boolean;
}): boolean {
  if (opts.amountLamports <= 0n) return true;
  const { buys, sells } = paperDepthTotals(opts.db, opts.userId, opts.mint, opts.cycleId);
  if (opts.requirePriorBuys && buys <= 0n) return false;

  const cap = opts.realSolReserves > 0n ? opts.realSolReserves : 0n;
  if (cap === 0n) return true; // provenance already applied; no reserve cap

  const nextNet = sells + opts.amountLamports - buys;
  return nextNet <= cap;
}

export function paperDepthBuys(db: Db, userId: string, mint: string, cycleId?: string | null): bigint {
  return paperDepthTotals(db, userId, mint, cycleId).buys;
}

export function paperDepthSells(db: Db, userId: string, mint: string, cycleId?: string | null): bigint {
  return paperDepthTotals(db, userId, mint, cycleId).sells;
}

export function spentPaperDepth(db: Db, userId: string, mint: string, cycleId?: string | null): bigint {
  const { buys, sells } = paperDepthTotals(db, userId, mint, cycleId);
  return sells - buys;
}

/** @deprecated global budget removed — always 0n */
export function spentPaperDepthGlobal(_mint: string): bigint {
  return 0n;
}

/** No-op: budget lives in `trades` (kept so test harnesses / exports stay stable). */
export function clearPaperDepthForTests(): void {
  /* intentionally empty */
}

/**
 * Test helper: insert a bonding buy/sell row so unit tests can drive the budget
 * without going through HTTP fills.
 */
export function recordPaperDepthTradeForTests(
  db: Db,
  opts: {
    userId: string;
    mint: string;
    cycleId: string;
    side: "buy" | "sell";
    amountLamports: bigint;
    id?: string;
  },
): void {
  const sol = lamportsToSol(opts.amountLamports < 0n ? 0n : opts.amountLamports);
  const trade =
    opts.side === "buy"
      ? { venue: "bonding", side: "buy", inAmount: sol, outAmount: "0", inUnit: "SOL", outUnit: "TOKEN" }
      : { venue: "bonding", side: "sell", inAmount: "0", outAmount: sol, inUnit: "TOKEN", outUnit: "SOL" };
  const id = opts.id ?? `td_${opts.side}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare(
    `INSERT INTO trades (id, user_id, cycle_id, mint, side, payload, idempotency_key, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(id, opts.userId, opts.cycleId, opts.mint, opts.side, JSON.stringify({ trade }), new Date().toISOString());
}

/** @deprecated use recordPaperDepthTradeForTests — kept name for older test imports */
export function creditPaperDepthBuy(opts: {
  db: Db;
  userId: string;
  mint: string;
  cycleId: string;
  amountLamports: bigint;
  realSolReserves?: bigint;
}): void {
  recordPaperDepthTradeForTests(opts.db, {
    userId: opts.userId,
    mint: opts.mint,
    cycleId: opts.cycleId,
    side: "buy",
    amountLamports: opts.amountLamports,
  });
}

/** @deprecated no speculative debit — trades are source of truth */
export function rollbackPaperDepthSell(_opts: { userId: string; mint: string; amountLamports: bigint }): void {
  /* no-op */
}
