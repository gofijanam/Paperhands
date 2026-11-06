/**
 * Poll-and-diff price ticks for subscribed mints; periodic leaderboard snapshots.
 * Uses catalog cache / DexScreener — no secrets printed.
 */
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { CatalogService } from "../services/catalog.js";
import type { StreamHub } from "./hub.js";
import { snapshotLeaderboard, getActiveCycle } from "../cycles/scheduler.js";
import { listFeedCoins } from "../catalog/curveStore.js";

export function startPricePoller(opts: {
  config: Config;
  db: Db;
  catalog: CatalogService;
  hub: StreamHub;
  getWatchedMints: () => string[];
  intervalMs?: number;
  leaderboardEveryMs?: number;
}) {
  const last = new Map<string, string>();
  let lastLb = 0;

  const tick = async () => {
    // Fair rotation provided by hub.getWatchedMintsFair when wired from main
    const mints = opts.getWatchedMints().slice(0, 40);
    for (const mint of mints) {
      try {
        const coin = await opts.catalog.getCoin(mint);
        if (!coin?.priceSol) continue;
        if (last.get(mint) === coin.priceSol) continue;
        last.set(mint, coin.priceSol);
        opts.hub.publish({
          type: "price",
          mint,
          priceSol: coin.priceSol,
          priceUsd: coin.priceUsd,
          venue: coin.venue,
        });
      } catch {
        /* skip mint */
      }
    }

    const now = Date.now();
    if (now - lastLb >= (opts.leaderboardEveryMs ?? 15_000)) {
      lastLb = now;
      try {
        const cycle = getActiveCycle(opts.db, opts.config);
        const { items: lb } = await snapshotLeaderboard(opts.db, opts.config, cycle.id, {
          catalog: opts.catalog,
        });
        opts.hub.publish({
          type: "leaderboard",
          cycleId: cycle.id,
          top: lb.slice(0, 10).map((x) => ({
            rank: x.rank,
            wallet: x.wallet,
            displayName: null,
            pnlPct: x.pnlPct,
            pnlSol: x.pnlSol,
            volumeSol: x.volumeSol,
            trades: x.trades,
            eligible: x.eligible,
            ineligibleReason: x.eligible ? null : "min trades",
          })),
        });
      } catch {
        /* */
      }
    }
  };

  const handle = setInterval(() => void tick(), opts.intervalMs ?? 5_000);
  return () => clearInterval(handle);
}

/** Seed graduated feed from GT trending (pumpswap) + DexScreener search. */
export async function seedGraduatedFeed(
  catalogHint: { search: (q: string, limit?: number) => Promise<any[]>; feed?: any },
  db: Db,
  fetcher: typeof fetch,
) {
  const { upsertFeedCoin } = await import("../catalog/curveStore.js");
  const { tokenBoostsTop, tokensByAddress, bestPairsByMint, pairToSummary, searchPairs } = await import("../catalog/dexscreener.js");
  const { trendingPoolsSolana, mapTrendingPools } = await import("../catalog/geckoterminal.js");

  let seeded = 0;
  try {
    const gt = await trendingPoolsSolana(fetcher, 20);
    const mapped = mapTrendingPools(gt);
    // Filter names that look like pump graduations via DS enrich
    const mints = mapped.map((m) => m.mint).filter(Boolean).slice(0, 30);
    if (mints.length) {
      const pairs = await tokensByAddress(mints, fetcher);
      const best = bestPairsByMint(pairs);
      for (const [mint, p] of best) {
        const dex = (p.dexId || "").toLowerCase();
        if (dex.includes("pump") || dex.includes("raydium") || dex.includes("meteora")) {
          const summary = pairToSummary(p, mint);
          summary.venue = "graduated";
          upsertFeedCoin(db, mint, "graduated", summary, summary.symbol, summary.name);
          seeded += 1;
        }
      }
    }
  } catch {
    /* */
  }

  try {
    const pairs = await searchPairs("pumpswap", fetcher);
    for (const p of pairs.slice(0, 25)) {
      const dex = (p.dexId || "").toLowerCase();
      if (!dex.includes("pump")) continue;
      const summary = pairToSummary(p);
      summary.venue = "graduated";
      if (!summary.mint) continue;
      upsertFeedCoin(db, summary.mint, "graduated", summary, summary.symbol, summary.name);
      seeded += 1;
    }
  } catch {
    /* */
  }

  try {
    const boosts = await tokenBoostsTop(fetcher);
    const sol = boosts.filter((b: any) => b.chainId === "solana").slice(0, 20);
    const mints = sol.map((b: any) => b.tokenAddress).filter(Boolean);
    if (mints.length) {
      const pairs = await tokensByAddress(mints, fetcher);
      for (const [, p] of bestPairsByMint(pairs)) {
        const summary = pairToSummary(p);
        summary.venue = "graduated";
        upsertFeedCoin(db, summary.mint, "graduated", summary, summary.symbol, summary.name);
        seeded += 1;
      }
    }
  } catch {
    /* */
  }

  return { seeded, existing: listFeedCoins(db, "graduated").length };
}
