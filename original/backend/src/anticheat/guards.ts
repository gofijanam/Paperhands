import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { TokenBucket } from "../lib/ratelimit.js";
import { parseDec, solToLamports } from "../lib/decimal.js";

const walletBuckets = new Map<string, { trade: TokenBucket; quote: TokenBucket; read: TokenBucket }>();

function bucketsFor(wallet: string) {
  let b = walletBuckets.get(wallet);
  if (!b) {
    b = {
      trade: new TokenBucket(20 / 60, 5),
      quote: new TokenBucket(30 / 60, 5),
      read: new TokenBucket(180 / 60, 20),
    };
    walletBuckets.set(wallet, b);
  }
  return b;
}

export function checkWalletRateLimit(wallet: string, kind: "trade" | "quote" | "read"): { ok: true } | { ok: false; retryAfterSec: number } {
  const b = bucketsFor(wallet);
  const bucket = b[kind];
  if (bucket.tryTake()) return { ok: true };
  return { ok: false, retryAfterSec: 3 };
}

/** Compare trade size via lamports (string path). Number overload kept for unit tests only. */
export function assertMinTradeSize(config: Config, amountSol: number | string): void {
  if (typeof amountSol === "string") {
    if (solToLamports(amountSol) < solToLamports(config.MIN_TRADE_SOL)) {
      throw Object.assign(new Error(`Min trade size ${config.MIN_TRADE_SOL} SOL`), { code: "validation_failed" });
    }
    return;
  }
  if (amountSol + 1e-12 < parseDec(config.MIN_TRADE_SOL)) {
    throw Object.assign(new Error(`Min trade size ${config.MIN_TRADE_SOL} SOL`), { code: "validation_failed" });
  }
}

/**
 * Fail closed when liquidity is null/unknown for competitive fills.
 * SOL notional compared via lamports when given as a decimal string.
 */
export function assertFillLiquidityCap(
  config: Config,
  notionalSol: number | string,
  liquidityUsd: string | null,
  solUsd: number | null = 180,
): void {
  if (liquidityUsd == null || liquidityUsd === "") {
    throw Object.assign(new Error("Liquidity unknown — fail closed"), { code: "untradeable" });
  }
  const liqUsd = parseDec(liquidityUsd);
  if (!(liqUsd > 0)) {
    throw Object.assign(new Error("No liquidity"), { code: "untradeable" });
  }
  if (solUsd == null || !(solUsd > 0)) {
    throw Object.assign(new Error("SOL/USD unknown — fail closed"), { code: "untradeable" });
  }

  let notional: number;
  if (typeof notionalSol === "string") {
    const lamports = solToLamports(notionalSol);
    if (lamports <= 0n) {
      throw Object.assign(new Error("Notional must be positive"), { code: "validation_failed" });
    }
    // USD compare uses Number only for the liquidity gate (not ledger); scale from lamports
    notional = Number(lamports) / 1e9;
  } else {
    notional = notionalSol;
  }

  const notionalUsd = notional * solUsd;
  const cap = (liqUsd * config.FILL_LIQUIDITY_CAP_PCT) / 100;
  if (notionalUsd > cap) {
    throw Object.assign(new Error(`Fill exceeds ${config.FILL_LIQUIDITY_CAP_PCT}% of liquidity`), {
      code: "untradeable",
    });
  }
}

/** Detect rapid buy→sell (or sell→buy) on tiny-liq coins within WASH_WINDOW_MS. Null liquidity = wash-risk. */
export function detectWash(
  db: Db,
  config: Config,
  userId: string,
  mint: string,
  side: "buy" | "sell",
  liquidityUsd: string | null,
): void {
  const liq = liquidityUsd != null && liquidityUsd !== "" ? parseDec(liquidityUsd) : 0;
  if (liq >= parseDec(config.WASH_LIQ_USD)) return;

  const row = db
    .prepare(
      `SELECT side, filled_at FROM trades WHERE user_id = ? AND mint = ? ORDER BY filled_at DESC LIMIT 1`,
    )
    .get(userId, mint) as { side: string; filled_at: string } | undefined;
  if (!row) return;
  const age = Date.now() - Date.parse(row.filled_at);
  if (age <= config.WASH_WINDOW_MS && row.side !== side) {
    throw Object.assign(
      new Error("Wash / self-dump pattern blocked on low-liquidity mint"),
      { code: "forbidden" },
    );
  }
}

export function clearRateLimitsForTests() {
  walletBuckets.clear();
}
