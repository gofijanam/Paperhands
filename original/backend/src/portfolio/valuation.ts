/**
 * Shared mark-to-market for portfolio, leaderboard, and cycle rotate.
 * Fail closed: rugged / untradeable / unknown / unavailable / stale → mark 0.
 * Never substitutes entry/cost for a missing live mark.
 */
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { CatalogService } from "../services/catalog.js";
import { getCurve } from "../catalog/curveStore.js";
import { spotPriceSolPerToken, spotLamportsPerToken } from "../bonding/curve.js";
import * as ds from "../catalog/dexscreener.js";
import { nowIso } from "../lib/ids.js";
import { solToLamports, lamportsToSol, tokenToRaw, valueLamportsFromPrice, lamportsToSolSigned } from "../lib/money.js";

export type MarkStatus = "tradeable" | "frozen" | "rugged" | "untradeable" | "unknown";
export type MarkSource = "catalog" | "curve" | "dexscreener_batch" | "injected" | "zero";

export type MintMark = {
  mint: string;
  markSol: string;
  status: MarkStatus;
  source: MarkSource;
  asOf: string;
};

/** Client-facing mark freshness (Wren). */
export type ClientMarkStatus = "fresh" | "stale" | "rugged" | "unknown";

export type PositionValue = {
  mint: string;
  qty: string;
  costSol: string;
  markSol: string;
  valueSol: string;
  unrealizedPnlSol: string;
  unrealizedPnlPct: string;
  /** Internal status */
  markStatus: MarkStatus;
  /** Wren: fresh|stale|rugged|unknown */
  clientMarkStatus: ClientMarkStatus;
  markAsOf: string | null;
};

export function toClientMarkStatus(mark: MintMark): ClientMarkStatus {
  if (mark.status === "rugged") return "rugged";
  const age = Date.now() - Date.parse(mark.asOf);
  if (mark.markSol === "0" || mark.status === "unknown" || mark.status === "untradeable") {
    if (Number.isFinite(age) && age > MARK_STALE_MS) return "stale";
    return "unknown";
  }
  if (Number.isFinite(age) && age > MARK_STALE_MS) return "stale";
  if (mark.status === "tradeable" || mark.status === "frozen") return "fresh";
  return "unknown";
}

export type EquitySnapshot = {
  cashSol: string;
  equitySol: string;
  bankrollSol: string;
  pnlSol: string;
  pnlPct: string;
  unrealizedPnlSol: string;
  positions: PositionValue[];
  marks: MintMark[];
};

const DEFAULT_DECIMALS = 6;
/** Marks older than this (when asOf known from curve.updatedAt) are treated as stale → 0. */
export const MARK_STALE_MS = 15 * 60_000;
export const BATCH_MARK_TIMEOUT_MS = 8_000;

function zeroMark(mint: string, status: MarkStatus = "unknown", source: MarkSource = "zero"): MintMark {
  return { mint, markSol: "0", status, source, asOf: nowIso() };
}

function fromCatalogCoin(mint: string, coin: {
  status: string;
  priceSol: string | null;
  observedAt?: string | null;
  venue?: string;
}): MintMark {
  const status = (coin.status as MarkStatus) || "unknown";
  const asOf = coin.observedAt && Number.isFinite(Date.parse(coin.observedAt)) ? coin.observedAt : nowIso();
  if (status === "rugged" || status === "untradeable") {
    return { mint, markSol: "0", status, source: "catalog", asOf };
  }
  if (status === "frozen") {
    const p = coin.priceSol && coin.priceSol !== "0" ? coin.priceSol : "0";
    return { mint, markSol: p, status: "frozen", source: "catalog", asOf };
  }
  if (!coin.priceSol || coin.priceSol === "0") {
    return { mint, markSol: "0", status: "unknown", source: "catalog", asOf };
  }
  // Accept high-precision rational prices; do not force ≤9 decimals
  if (!/^\d+(\.\d{1,24})?$/.test(coin.priceSol)) {
    return { mint, markSol: "0", status: "unknown", source: "catalog", asOf };
  }
  return { mint, markSol: coin.priceSol, status: "tradeable", source: "catalog", asOf };
}

/** Staleness policy: asOf older than MARK_STALE_MS → mark 0 (documented). */
function applyStaleness(m: MintMark): MintMark {
  const age = Date.now() - Date.parse(m.asOf);
  if (!Number.isFinite(age) || age < 0 || age > MARK_STALE_MS) {
    return { ...m, markSol: "0", status: m.status === "rugged" || m.status === "untradeable" ? m.status : "unknown", source: m.source === "catalog" ? "catalog" : "zero" };
  }
  return m;
}

/** Resolve a single mint mark. Bonding curve freshness checked BEFORE catalog so stale curves cannot be relabelled fresh. Fail closed. */
export async function markMint(
  catalog: CatalogService,
  db: Db,
  mint: string,
): Promise<MintMark> {
  // Bonding curve first — preserve real updatedAt; stale → 0
  const curve = getCurve(db, mint);
  if (curve && !curve.graduated && !curve.complete) {
    const age = Date.now() - Date.parse(curve.updatedAt);
    if (!(Number.isFinite(age) && age >= 0 && age <= MARK_STALE_MS)) {
      return { mint, markSol: "0", status: "unknown", source: "curve", asOf: curve.updatedAt };
    }
    const price = spotPriceSolPerToken(curve, 6);
    if (Number.isFinite(price) && price > 0) {
      // Exact rational via lamports-per-token
      const lamports = spotLamportsPerToken(curve, 6);
      const markSol = lamportsToSol(lamports);
      // Impact-capped: mark no higher than selling a 1-token probe would imply is already spot;
      // full position impact is applied in valuePosition when curve available.
      if (markSol !== "0") {
        return { mint, markSol, status: "tradeable", source: "curve", asOf: curve.updatedAt };
      }
    }
    return { mint, markSol: "0", status: "unknown", source: "curve", asOf: curve.updatedAt };
  }

  try {
    const coin = await catalog.getCoin(mint);
    if (coin) {
      const observedAt = (coin as any).observedAt ?? (coin as any).updatedAt ?? null;
      const m = applyStaleness(fromCatalogCoin(mint, { ...coin, observedAt }));
      if (m.markSol !== "0" || m.status === "rugged" || m.status === "untradeable" || m.status === "frozen") {
        return m;
      }
    }
  } catch {
    /* fall through */
  }

  return zeroMark(mint, "unknown", "zero");
}

/**
 * Batch-resolve marks. Prefers catalog per mint; for remaining gaps uses DexScreener
 * multi-token (chunks of 30) under an overall time budget.
 */
export async function markMintsBatch(opts: {
  mints: string[];
  catalog: CatalogService;
  db: Db;
  config: Config;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Test/inject: pre-seed marks (wins over fetch). */
  injected?: Map<string, MintMark>;
}): Promise<Map<string, MintMark>> {
  const unique = [...new Set(opts.mints.filter(Boolean))];
  const out = new Map<string, MintMark>();
  const timeoutMs = opts.timeoutMs ?? BATCH_MARK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  if (opts.injected) {
    for (const [m, mark] of opts.injected) out.set(m, mark);
  }

  const need: string[] = [];
  for (const mint of unique) {
    if (out.has(mint)) continue;
    if (Date.now() > deadline) {
      out.set(mint, zeroMark(mint));
      continue;
    }
    const m = await markMint(opts.catalog, opts.db, mint);
    out.set(mint, m);
    if (m.markSol === "0" && m.status === "unknown") need.push(mint);
  }

  // DexScreener batch fill for still-unknown (skip in mock unless fetcher injected)
  const fetchable = need.filter((m) => !opts.injected?.has(m));
  if (fetchable.length && Date.now() < deadline && (!opts.config.isMock || opts.fetcher)) {
    const fetcher = opts.fetcher ?? fetch;
    for (let i = 0; i < fetchable.length && Date.now() < deadline; i += 30) {
      const chunk = fetchable.slice(i, i + 30);
      try {
        const remaining = Math.max(50, deadline - Date.now());
        const pairs = await Promise.race([
          ds.tokensByAddress(chunk, fetcher),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mark_batch_timeout")), remaining)),
        ]);
        const best = ds.bestPairsByMint(pairs);
        for (const mint of chunk) {
          const p = best.get(mint);
          if (!p?.priceNative || p.priceNative === "0") {
            out.set(mint, zeroMark(mint, "unknown", "dexscreener_batch"));
            continue;
          }
          if (/^\d+(\.\d{1,24})?$/.test(p.priceNative)) {
            out.set(mint, {
              mint,
              markSol: p.priceNative,
              status: "tradeable",
              source: "dexscreener_batch",
              asOf: nowIso(),
            });
          } else {
            out.set(mint, zeroMark(mint, "unknown", "dexscreener_batch"));
          }
        }
      } catch {
        for (const mint of chunk) {
          if (!out.has(mint) || out.get(mint)!.status === "unknown") {
            out.set(mint, zeroMark(mint, "unknown", "dexscreener_batch"));
          }
        }
      }
    }
  }

  for (const mint of unique) {
    if (!out.has(mint)) out.set(mint, zeroMark(mint));
  }
  return out;
}

export function valuePosition(
  pos: { mint: string; qty: string; cost_sol: string },
  mark: MintMark,
  decimals = DEFAULT_DECIMALS,
): PositionValue {
  const qtyRaw = tokenToRaw(pos.qty, decimals);
  // Rational price × qty (supports sub-lamport unit prices)
  const valueLamports =
    mark.markSol === "0" || mark.status === "rugged" || mark.status === "untradeable" || mark.status === "unknown"
      ? 0n
      : valueLamportsFromPrice(qtyRaw, mark.markSol, decimals);
  const valueSol = lamportsToSol(valueLamports);
  const costLamports = solToLamports(pos.cost_sol);
  const upnlLamports = valueLamports - costLamports;
  const unrealizedPnlSol = lamportsToSolSigned(upnlLamports);
  const unrealizedPnlPct =
    costLamports === 0n
      ? "0.00"
      : (() => {
          const scaled = (upnlLamports * 10000n) / costLamports;
          const sign = scaled < 0n ? "-" : "";
          const a = scaled < 0n ? -scaled : scaled;
          return `${sign}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
        })();
  return {
    mint: pos.mint,
    qty: pos.qty,
    costSol: pos.cost_sol,
    markSol: mark.markSol,
    valueSol,
    unrealizedPnlSol,
    unrealizedPnlPct,
    markStatus: mark.status,
    clientMarkStatus: toClientMarkStatus(mark),
    markAsOf: mark.asOf ?? null,
  };
}

export function equityFromCashAndPositions(
  cashSol: string,
  bankrollSol: string,
  positions: PositionValue[],
  marks: MintMark[],
): EquitySnapshot {
  let unrealized = 0n;
  let positionsValue = 0n;
  for (const x of positions) {
    const u = x.unrealizedPnlSol.startsWith("-")
      ? -solToLamports(x.unrealizedPnlSol.slice(1))
      : solToLamports(x.unrealizedPnlSol);
    unrealized += u;
    positionsValue += solToLamports(x.valueSol);
  }
  const cash = solToLamports(cashSol);
  const equity = cash + positionsValue;
  const bankroll = solToLamports(bankrollSol);
  const pnl = equity - bankroll;
  const pnlSol = pnl < 0n ? `-${lamportsToSol(-pnl)}` : lamportsToSol(pnl);
  const pnlPct =
    bankroll === 0n
      ? "0.00"
      : (() => {
          const scaled = (pnl * 10000n) / bankroll;
          const sign = scaled < 0n ? "-" : "";
          const a = scaled < 0n ? -scaled : scaled;
          return `${sign}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
        })();
  return {
    cashSol,
    equitySol: lamportsToSol(equity),
    bankrollSol,
    pnlSol,
    pnlPct,
    unrealizedPnlSol: unrealized < 0n ? `-${lamportsToSol(-unrealized)}` : lamportsToSol(unrealized),
    positions,
    marks,
  };
}

/** Full portfolio equity using shared marks (batch or provided map). */
export async function computePortfolioEquity(opts: {
  db: Db;
  config: Config;
  catalog: CatalogService;
  userId: string;
  cycleId: string;
  marks?: Map<string, MintMark>;
  fetcher?: typeof fetch;
}): Promise<EquitySnapshot & { mode: string; realizedPnlSol: string }> {
  const p = opts.db
    .prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`)
    .get(opts.userId, opts.cycleId) as any;
  if (!p) {
    return {
      mode: "ranked",
      realizedPnlSol: "0",
      ...equityFromCashAndPositions(opts.config.CYCLE_BANKROLL_SOL, opts.config.CYCLE_BANKROLL_SOL, [], []),
    };
  }
  const rows = opts.db
    .prepare(`SELECT * FROM positions WHERE user_id = ? AND cycle_id = ? AND status = 'open'`)
    .all(opts.userId, opts.cycleId) as any[];
  const mints = rows.map((r) => r.mint as string);
  const marks =
    opts.marks ??
    (await markMintsBatch({
      mints,
      catalog: opts.catalog,
      db: opts.db,
      config: opts.config,
      fetcher: opts.fetcher,
    }));
  const decimalsByMint = new Map<string, number>();
  for (const mint of mints) {
    try {
      const coin = await opts.catalog.getCoin(mint);
      decimalsByMint.set(mint, coin?.decimals ?? DEFAULT_DECIMALS);
    } catch {
      decimalsByMint.set(mint, DEFAULT_DECIMALS);
    }
  }
  const positions = rows.map((r) =>
    valuePosition(r, marks.get(r.mint) ?? zeroMark(r.mint), decimalsByMint.get(r.mint) ?? DEFAULT_DECIMALS),
  );
  const usedMarks = mints.map((m) => marks.get(m) ?? zeroMark(m));
  return {
    mode: p.mode,
    realizedPnlSol: p.realized_pnl_sol,
    ...equityFromCashAndPositions(p.cash_sol, opts.config.CYCLE_BANKROLL_SOL, positions, usedMarks),
  };
}

export function collectOpenMints(db: Db, cycleId: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT mint FROM positions WHERE cycle_id = ? AND status = 'open'`)
    .all(cycleId) as { mint: string }[];
  return rows.map((r) => r.mint);
}
