/**
 * Atomic paper fill: BEGIN IMMEDIATE, conditional debit, single-use quote, exposure check.
 */
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { id, nowIso } from "../lib/ids.js";
import { solToLamports, lamportsToSol, solToLamportsSigned, lamportsToSolSigned, tokenToRaw, rawToToken } from "../lib/money.js";
import { audit } from "../lib/audit.js";

export type QuotePayload = {
  quoteId: string;
  mint: string;
  side: "buy" | "sell";
  venue: string;
  inAmount: string;
  inUnit: "sol" | "token";
  outAmount: string;
  outUnit: "sol" | "token";
  priceSol: string;
  priceImpactPct: string;
  fee: { venueFeeSol: string; priorityFeeSol: string; venueFeeBps: number; platformFeeBps: number; platformFeeSol: string };
  slippageBps: number;
  minOutAmount: string;
  liquidityUsd: string | null;
  expiresAt: string;
  route: string;
  warnings: string[];
  userId?: string;
  decimals?: number;
  /** Snapshot real SOL reserves (lamports) for cumulative paper-depth budget. */
  curveRealSolLamports?: string;
};

export type FillResult =
  | { ok: true; trade: any; cashSol: string; positionId: string | null; realizedPnlSol: string | null }
  | { ok: false; code: string; message: string };

const userLocks = new Map<string, Promise<void>>();

async function withUserLock<T>(userId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  userLocks.set(userId, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userLocks.get(userId) === gate) userLocks.delete(userId);
  }
}

export async function executeFillAtomic(opts: {
  db: Db;
  config: Config;
  userId: string;
  wallet: string;
  cycleId: string;
  quote: QuotePayload;
  symbol: string;
  decimals: number;
  idempotencyKey: string | null;
  coinStatus: string;
  flaggedStatus: string | null;
}): Promise<FillResult> {
  return withUserLock(opts.userId, () => fillInner(opts));
}

function fillInner(opts: {
  db: Db;
  config: Config;
  userId: string;
  wallet: string;
  cycleId: string;
  quote: QuotePayload;
  symbol: string;
  decimals: number;
  idempotencyKey: string | null;
  coinStatus: string;
  flaggedStatus: string | null;
}): FillResult {
  const { db, config, userId, wallet, cycleId, quote: q } = opts;

  if (opts.flaggedStatus === "frozen" || opts.coinStatus === "frozen") {
    return { ok: false, code: "untradeable", message: "Mint is frozen" };
  }
  if (opts.flaggedStatus === "rugged" || opts.coinStatus === "rugged" || opts.coinStatus === "untradeable") {
    return { ok: false, code: "untradeable", message: "Mint is untradeable" };
  }
  if (Date.parse(q.expiresAt) < Date.now()) {
    return { ok: false, code: "quote_stale", message: "Quote expired" };
  }

  // Idempotency short-circuit outside tx is fine; inside we also unique-index
  if (opts.idempotencyKey) {
    const prev = db.prepare(`SELECT payload FROM trades WHERE user_id = ? AND idempotency_key = ?`).get(userId, opts.idempotencyKey) as any;
    if (prev) {
      const parsed = JSON.parse(prev.payload);
      return {
        ok: true,
        trade: parsed.trade,
        cashSol: parsed.portfolio?.cashSol ?? "0",
        positionId: parsed.trade?.positionId ?? null,
        realizedPnlSol: parsed.trade?.realizedPnlSol ?? null,
        // mark as replay
      } as any;
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Consume quote (single-use + ownership)
    const qrow = db
      .prepare(`SELECT id, user_id, payload, expires_at, used FROM quotes WHERE id = ?`)
      .get(q.quoteId) as any;
    if (!qrow || qrow.user_id !== userId) {
      db.exec("ROLLBACK");
      return { ok: false, code: "quote_foreign", message: "Quote not found for user" };
    }
    if (qrow.used) {
      db.exec("ROLLBACK");
      return { ok: false, code: "quote_used", message: "Quote already used" };
    }
    if (Date.parse(qrow.expires_at) < Date.now()) {
      db.exec("ROLLBACK");
      return { ok: false, code: "quote_stale", message: "Quote expired" };
    }
    const stored: QuotePayload = JSON.parse(qrow.payload);
    if (stored.mint !== q.mint || stored.side !== q.side || stored.inAmount !== q.inAmount || stored.outAmount !== q.outAmount) {
      db.exec("ROLLBACK");
      return { ok: false, code: "quote_foreign", message: "Quote mismatch" };
    }

    // Ensure portfolio row
    let pf = db.prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`).get(userId, cycleId) as any;
    if (!pf) {
      db.prepare(
        `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
         VALUES (?, ?, 'ranked', ?, '0', '0', 0)`,
      ).run(userId, cycleId, config.CYCLE_BANKROLL_SOL);
      pf = db.prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`).get(userId, cycleId);
    }

    const priorityLamports = solToLamports(q.fee.priorityFeeSol);
    const venueFeeLamports = solToLamports(q.fee.venueFeeSol);
    let positionId: string | null = null;
    let realizedPnlSol: string | null = null;
    const tradeId = id("trd_");
    const filledAt = nowIso();

    if (q.side === "buy") {
      const spendLamports = solToLamports(q.inAmount) + priorityLamports;
      const spendSol = lamportsToSol(spendLamports);

      // Total exposure: existing cost + this spend vs bankroll
      const existing = db
        .prepare(`SELECT * FROM positions WHERE user_id = ? AND cycle_id = ? AND mint = ? AND status = 'open'`)
        .get(userId, cycleId, q.mint) as any;
      const existingCost = existing ? solToLamports(existing.cost_sol) : 0n;
      const bankroll = solToLamports(config.CYCLE_BANKROLL_SOL);
      const newExposure = existingCost + solToLamports(q.inAmount);
      if (newExposure * 100n > bankroll * BigInt(config.MAX_POSITION_PCT)) {
        db.exec("ROLLBACK");
        return { ok: false, code: "exposure_exceeded", message: "Max position exceeded" };
      }

      const cashLamports = solToLamports(pf.cash_sol);
      if (cashLamports < spendLamports) {
        db.exec("ROLLBACK");
        return { ok: false, code: "insufficient_funds", message: "Insufficient paper SOL" };
      }
      const newCash = lamportsToSol(cashLamports - spendLamports);
      const vol = lamportsToSol(solToLamports(pf.volume_sol) + solToLamports(q.inAmount));
      const upd = db
        .prepare(
          `UPDATE portfolios SET cash_sol = ?, volume_sol = ?, trade_count = trade_count + 1
           WHERE user_id = ? AND cycle_id = ? AND cash_sol = ?`,
        )
        .run(newCash, vol, userId, cycleId, pf.cash_sol);
      if (upd.changes !== 1) {
        db.exec("ROLLBACK");
        return { ok: false, code: "conflict", message: "Concurrent balance update" };
      }

      const outRaw = tokenToRaw(q.outAmount, opts.decimals);
      if (existing) {
        const newQtyRaw = tokenToRaw(existing.qty, opts.decimals) + outRaw;
        const newCostLamports = solToLamports(existing.cost_sol) + solToLamports(q.inAmount);
        const avgEntry = divSolByToken(newCostLamports, newQtyRaw, opts.decimals);
        db.prepare(`UPDATE positions SET qty = ?, cost_sol = ?, avg_entry_sol = ? WHERE id = ?`).run(
          rawToToken(newQtyRaw, opts.decimals),
          lamportsToSol(newCostLamports),
          avgEntry,
          existing.id,
        );
        positionId = existing.id;
      } else {
        positionId = id("pos_");
        db.prepare(
          `INSERT INTO positions (id, user_id, cycle_id, mint, symbol, qty, avg_entry_sol, cost_sol, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        ).run(positionId, userId, cycleId, q.mint, opts.symbol, q.outAmount, q.priceSol, q.inAmount);
      }
      pf = { ...pf, cash_sol: newCash };
    } else {
      // sell
      const existing = db
        .prepare(`SELECT * FROM positions WHERE user_id = ? AND cycle_id = ? AND mint = ? AND status = 'open'`)
        .get(userId, cycleId, q.mint) as any;
      if (!existing) {
        db.exec("ROLLBACK");
        return { ok: false, code: "forbidden", message: "No position" };
      }
      const qtyRaw = tokenToRaw(existing.qty, opts.decimals);
      const sellRaw = tokenToRaw(q.inAmount, opts.decimals);
      if (sellRaw > qtyRaw) {
        db.exec("ROLLBACK");
        return { ok: false, code: "forbidden", message: "Insufficient position" };
      }
      const proceedsLamports = solToLamports(q.outAmount) - priorityLamports;
      if (proceedsLamports < 0n) {
        db.exec("ROLLBACK");
        return { ok: false, code: "untradeable", message: "Proceeds negative after fees" };
      }
      const costLamports = solToLamports(existing.cost_sol);
      const costBasis = qtyRaw === 0n ? 0n : (costLamports * sellRaw) / qtyRaw;
      const realized = proceedsLamports - costBasis;
      realizedPnlSol = lamportsToSolSigned(realized);

      const newCash = lamportsToSol(solToLamports(pf.cash_sol) + proceedsLamports);
      const left = qtyRaw - sellRaw;
      if (left === 0n) {
        db.prepare(`UPDATE positions SET qty = '0', cost_sol = '0', status = 'closed' WHERE id = ?`).run(existing.id);
      } else {
        db.prepare(`UPDATE positions SET qty = ?, cost_sol = ? WHERE id = ?`).run(
          rawToToken(left, opts.decimals),
          lamportsToSol(costLamports - costBasis),
          existing.id,
        );
      }
      positionId = existing.id;
      const vol = lamportsToSol(solToLamports(pf.volume_sol) + solToLamports(q.outAmount));
      const realizedTotal = lamportsToSolSigned(solToLamportsSigned(pf.realized_pnl_sol || "0") + realized);
      const upd = db
        .prepare(
          `UPDATE portfolios SET cash_sol = ?, volume_sol = ?, trade_count = trade_count + 1, realized_pnl_sol = ?
           WHERE user_id = ? AND cycle_id = ? AND cash_sol = ?`,
        )
        .run(newCash, vol, realizedTotal, userId, cycleId, pf.cash_sol);
      if (upd.changes !== 1) {
        db.exec("ROLLBACK");
        return { ok: false, code: "conflict", message: "Concurrent balance update" };
      }
      pf = { ...pf, cash_sol: newCash };
    }

    db.prepare(`UPDATE quotes SET used = 1 WHERE id = ? AND used = 0`).run(q.quoteId);

    const trade = {
      id: tradeId,
      cycleId,
      mint: q.mint,
      side: q.side,
      venue: q.venue,
      inAmount: q.inAmount,
      inUnit: q.inUnit,
      outAmount: q.outAmount,
      outUnit: q.outUnit,
      priceSol: q.priceSol,
      priceImpactPct: q.priceImpactPct,
      feesSol: lamportsToSol(venueFeeLamports + priorityLamports),
      realizedPnlSol,
      status: "filled" as const,
      filledAt,
      positionId,
    };

    // Placeholder payload; caller enriches with portfolio snapshot after commit
    db.prepare(
      `INSERT INTO trades (id, user_id, cycle_id, mint, side, payload, idempotency_key, filled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tradeId, userId, cycleId, q.mint, q.side, JSON.stringify({ trade }), opts.idempotencyKey, filledAt);

    audit(db, wallet, "trade.fill", { tradeId, mint: q.mint, side: q.side, quoteId: q.quoteId });

    db.exec("COMMIT");
    return { ok: true, trade, cashSol: pf.cash_sol, positionId, realizedPnlSol };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* */
    }
    throw e;
  }
}

function divSolByToken(costLamports: bigint, qtyRaw: bigint, decimals: number): string {
  if (qtyRaw === 0n) return "0";
  // price lamports per whole token = costLamports * 10^decimals / qtyRaw
  const scale = 10n ** BigInt(decimals);
  const lamportsPerToken = (costLamports * scale) / qtyRaw;
  return lamportsToSol(lamportsPerToken);
}

export function clearUserLocks() {
  userLocks.clear();
}
