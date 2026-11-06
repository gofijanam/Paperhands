import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { CoinSummaryT, CoinDetailT } from "../contracts.js";
import { loadMockCoins, mockCandles } from "../mock/fixtures.js";
import * as ds from "../catalog/dexscreener.js";
import * as gt from "../catalog/geckoterminal.js";
import {
  getCurve,
  listAboutToGraduate,
  listNewBonding,
  listFeedCoins,
  ensureCurveTable,
} from "../catalog/curveStore.js";
import type { RpcClient } from "../rpc/client.js";
import { fetchCurveState, curveToProgressPct } from "../bonding/onchain.js";
import { upsertCurve } from "../catalog/curveStore.js";
import { spotPriceSolPerToken } from "../bonding/curve.js";
import { nowIso } from "../lib/ids.js";
import { fetchMarketTrades } from "../catalog/trades.js";

export type CatalogDeps = {
  config: Config;
  db: Db;
  rpc?: RpcClient;
  fetcher?: typeof fetch;
};


async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(Object.assign(new Error(`${label}_timeout`), { code: "upstream_degraded" })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export class CatalogService {
  private mock = loadMockCoins();
  constructor(private deps: CatalogDeps) {
    ensureCurveTable(deps.db);
  }

  async search(q: string, limit = 25): Promise<CoinSummaryT[]> {
    if (this.deps.config.isMock) {
      const qq = q.toLowerCase();
      return this.mock
        .filter(
          (x) =>
            x.mint.toLowerCase().includes(qq) ||
            x.symbol.toLowerCase().includes(qq) ||
            x.name.toLowerCase().includes(qq),
        )
        .slice(0, limit);
    }
    const pairs = await ds.searchPairs(q, this.deps.fetcher);
    const best = ds.bestPairsByMint(pairs);
    return [...best.values()].slice(0, limit).map((p) => ds.pairToSummary(p));
  }

  async getCoin(mint: string): Promise<CoinDetailT | null> {
    const ms = this.deps.config.UPSTREAM_TIMEOUT_MS ?? 4000;
    return withTimeout(this.getCoinInner(mint), ms, "getCoin");
  }

  private async getCoinInner(mint: string) {
    if (this.deps.config.isMock) {
      const base = this.mock.find((x) => x.mint === mint);
      if (!base) return null;
      return this.toDetail(this.applyFlags(mint, base));
    }

    // Prefer on-chain bonding curve when present
    let curve = getCurve(this.deps.db, mint);
    if (this.deps.rpc) {
      const live = await fetchCurveState(this.deps.rpc, mint);
      if (live) {
        const progressPct = curveToProgressPct(live);
        upsertCurve(this.deps.db, mint, live, { progressPct, graduated: live.complete });
        curve = getCurve(this.deps.db, mint);
      }
    }

    const pairs = await ds.tokensByAddress([mint], this.deps.fetcher);
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    let summary: CoinSummaryT | null = best ? ds.pairToSummary(best, mint) : null;

    if (curve && !curve.graduated && !curve.complete) {
      const priceSol = spotPriceSolPerToken(curve, 6);
      summary = {
        mint,
        symbol: curve.symbol ?? summary?.symbol ?? "?",
        name: curve.name ?? summary?.name ?? "Unknown",
        decimals: 6,
        imageUrl: summary?.imageUrl ?? null,
        venue: "bonding",
        status: "tradeable",
        priceSol: String(priceSol),
        priceUsd: summary?.priceUsd ?? null,
        liquidityUsd: summary?.liquidityUsd ?? null,
        marketCapUsd: summary?.marketCapUsd ?? null,
        volume24hUsd: summary?.volume24hUsd ?? null,
        change24hPct: summary?.change24hPct ?? null,
        ageSec: summary?.ageSec ?? null,
        bondingProgressPct: curve.progressPct.toFixed(1),
        pairAddress: summary?.pairAddress ?? null,
        dexId: "pumpfun",
        riskBadges: curve.progressPct >= this.deps.config.GRADUATING_PCT ? ["about_to_graduate"] : ["new_mint"],
        // Preserve real curve observation time — never relabel stale as fresh (P2-05)
        observedAt: curve.updatedAt,
      } as any;
    }

    if (!summary) {
      // Known only via pump portal ingest
      const feed = listFeedCoins(this.deps.db, "new").find((c: any) => c.mint === mint);
      if (!feed) return null;
      summary = feed as CoinSummaryT;
    }

    // Rug / zero liquidity
    if (summary.venue === "graduated") {
      const liq = Number(summary.liquidityUsd ?? 0);
      if (!summary.priceSol || summary.priceSol === "0" || liq < Number(this.deps.config.MIN_LIQUIDITY_USD)) {
        if (liq <= 0 || summary.priceSol === "0") {
          summary = { ...summary, status: "rugged", riskBadges: [...new Set([...summary.riskBadges, "rugged", "no_liquidity"])] };
        } else {
          summary = { ...summary, status: "untradeable", riskBadges: [...new Set([...summary.riskBadges, "low_liquidity"])] };
        }
      }
    }

    summary = this.applyFlags(mint, summary);
    return this.toDetail(summary, curve);
  }

  private applyFlags(mint: string, summary: CoinSummaryT): CoinSummaryT {
    const flag = this.deps.db
      .prepare(`SELECT status, reason FROM coin_flags WHERE mint = ?`)
      .get(mint) as { status: string; reason: string | null } | undefined;
    if (!flag) return summary;
    const badges = new Set([...(summary.riskBadges ?? []), flag.status]);
    return { ...summary, status: flag.status as any, riskBadges: [...badges] };
  }

  private toDetail(summary: CoinSummaryT, curve?: ReturnType<typeof getCurve>): CoinDetailT {
    return {
      ...summary,
      description: this.deps.config.isMock ? "MOCK coin detail for Wren." : null,
      socials: { twitter: null, telegram: null, website: null },
      fdvUsd: summary.marketCapUsd,
      change5mPct: null,
      change1hPct: null,
      change6hPct: summary.change24hPct,
      virtualSolReserves: curve ? curve.virtualSolReserves.toString() : summary.venue === "bonding" ? "45000000000" : null,
      virtualTokenReserves: curve ? curve.virtualTokenReserves.toString() : summary.venue === "bonding" ? "800000000000000" : null,
      realSolReserves: curve ? curve.realSolReserves.toString() : null,
      realTokenReserves: curve ? curve.realTokenReserves.toString() : null,
      complete: curve ? curve.complete : summary.venue === "graduated",
      updatedAt: nowIso(),
      _mock: this.deps.config.isMock ? true : undefined,
    };
  }

  async feed(kind: string, limit = 25): Promise<CoinSummaryT[]> {
    if (this.deps.config.isMock) {
      if (kind === "trending") return [...this.mock].sort((a, b) => Number(b.volume24hUsd ?? 0) - Number(a.volume24hUsd ?? 0)).slice(0, limit);
      if (kind === "new") return this.mock.filter((x) => x.venue === "bonding").slice(0, limit);
      if (kind === "about_to_graduate")
        return this.mock.filter((x) => x.bondingProgressPct && Number(x.bondingProgressPct) >= this.deps.config.GRADUATING_PCT).slice(0, limit);
      if (kind === "graduated") return this.mock.filter((x) => x.venue === "graduated" && x.status === "tradeable").slice(0, limit);
      throw Object.assign(new Error("unknown feed kind"), { code: "validation_failed" });
    }

    if (kind === "trending") {
      try {
        const json = await gt.trendingPoolsSolana(this.deps.fetcher, limit);
        const mapped = gt.mapTrendingPools(json);
        // Enrich with DS when we have mints
        const mints = mapped.map((m) => m.mint).filter(Boolean).slice(0, 30);
        let byMint = new Map<string, ds.DsPair>();
        if (mints.length) {
          try {
            byMint = ds.bestPairsByMint(await ds.tokensByAddress(mints, this.deps.fetcher));
          } catch {
            /* optional enrich */
          }
        }
        return mapped.slice(0, limit).map((m) => {
          const p = byMint.get(m.mint);
          if (p) return ds.pairToSummary(p, m.mint);
          return {
            mint: m.mint || m.pairAddress || "unknown",
            symbol: m.symbol,
            name: m.name,
            decimals: 6,
            imageUrl: null,
            venue: "graduated" as const,
            status: "tradeable" as const,
            priceSol: null,
            priceUsd: m.priceUsd,
            liquidityUsd: m.liquidityUsd,
            marketCapUsd: null,
            volume24hUsd: m.volume24hUsd,
            change24hPct: m.change24hPct,
            ageSec: null,
            bondingProgressPct: null,
            pairAddress: m.pairAddress,
            dexId: "geckoterminal",
            riskBadges: [],
          };
        });
      } catch {
        // Fallback: DexScreener boosts
        const boosts = await ds.tokenBoostsTop(this.deps.fetcher);
        const sol = boosts.filter((b: any) => b.chainId === "solana").slice(0, limit);
        const mints = sol.map((b: any) => b.tokenAddress).filter(Boolean);
        const pairs = mints.length ? await ds.tokensByAddress(mints, this.deps.fetcher) : [];
        const best = ds.bestPairsByMint(pairs);
        return [...best.values()].slice(0, limit).map((p) => ds.pairToSummary(p));
      }
    }

    if (kind === "new") {
      const fromDb = listNewBonding(this.deps.db, limit).map((c) => ({
        mint: c.mint,
        symbol: c.symbol ?? "?",
        name: c.name ?? "Unknown",
        decimals: 6,
        imageUrl: null,
        venue: "bonding" as const,
        status: "tradeable" as const,
        priceSol: String(spotPriceSolPerToken(c)),
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        change24hPct: null,
        ageSec: null,
        bondingProgressPct: c.progressPct.toFixed(1),
        pairAddress: null,
        dexId: "pumpfun",
        riskBadges: ["new_mint"] as string[],
      }));
      const feed = listFeedCoins(this.deps.db, "new") as CoinSummaryT[];
      const map = new Map<string, CoinSummaryT>();
      for (const c of [...fromDb, ...feed]) map.set(c.mint, c);
      return [...map.values()].slice(0, limit);
    }

    if (kind === "about_to_graduate") {
      return listAboutToGraduate(this.deps.db, this.deps.config.GRADUATING_PCT, limit).map((c) => ({
        mint: c.mint,
        symbol: c.symbol ?? "?",
        name: c.name ?? "Unknown",
        decimals: 6,
        imageUrl: null,
        venue: "bonding" as const,
        status: "tradeable" as const,
        priceSol: String(spotPriceSolPerToken(c)),
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        change24hPct: null,
        ageSec: null,
        bondingProgressPct: c.progressPct.toFixed(1),
        pairAddress: null,
        dexId: "pumpfun",
        riskBadges: ["about_to_graduate"],
      }));
    }

    if (kind === "graduated") {
      const feed = listFeedCoins(this.deps.db, "graduated") as CoinSummaryT[];
      if (feed.length >= Math.min(5, limit)) return feed.slice(0, limit);

      // Cold-start fallback: DexScreener pumpswap search + GT trending pumpswap pools
      const map = new Map<string, CoinSummaryT>();
      for (const c of feed) map.set(c.mint, c);
      try {
        const pairs = await ds.searchPairs("pumpswap", this.deps.fetcher);
        for (const p of pairs) {
          const dex = (p.dexId || "").toLowerCase();
          if (!dex.includes("pump") && dex !== "pumpswap") continue;
          const summary = ds.pairToSummary(p);
          summary.venue = "graduated";
          if (summary.mint) map.set(summary.mint, summary);
        }
      } catch { /* */ }
      try {
        const json = await gt.trendingPoolsSolana(this.deps.fetcher, limit);
        const mapped = gt.mapTrendingPools(json);
        const mints = mapped.map((m) => m.mint).filter(Boolean).slice(0, 30);
        if (mints.length) {
          const pairs = await ds.tokensByAddress(mints, this.deps.fetcher);
          for (const [, p] of ds.bestPairsByMint(pairs)) {
            const summary = ds.pairToSummary(p);
            summary.venue = "graduated";
            map.set(summary.mint, summary);
          }
        }
      } catch { /* */ }
      return [...map.values()].slice(0, limit);
    }

    throw Object.assign(new Error("unknown feed kind"), { code: "validation_failed" });
  }

  async ohlcv(mint: string, resolution: string, currency: "usd" | "sol" = "usd") {
    if (this.deps.config.isMock) {
      return { mint, resolution, currency, candles: mockCandles(mint), _mock: true as const };
    }
    const coin = await this.getCoin(mint);
    const pool = coin?.pairAddress;
    if (!pool) {
      return { mint, resolution, currency, candles: [] as any[] };
    }
    const mapRes: Record<string, { tf: "minute" | "hour" | "day"; agg: number }> = {
      "1m": { tf: "minute", agg: 1 },
      "5m": { tf: "minute", agg: 5 },
      "15m": { tf: "minute", agg: 15 },
      "1h": { tf: "hour", agg: 1 },
      "4h": { tf: "hour", agg: 4 },
      "1d": { tf: "day", agg: 1 },
    };
    const r = mapRes[resolution] ?? mapRes["5m"];
    const json = await gt.poolOhlcv(pool, r.tf, r.agg, this.deps.fetcher);
    return { mint, resolution, currency, candles: gt.mapOhlcv(json) };
  }

  async holders(mint: string, limit = 50) {
    if (this.deps.config.isMock || !this.deps.rpc) {
      return {
        items: [
          { rank: 1, wallet: "BondingCurve11111111111111111111111111111", amount: "200000000", pct: "20.0" },
          { rank: 2, wallet: "HolderMock2222222222222222222222222222222", amount: "50000000", pct: "5.0" },
        ],
        totalSupply: "1000000000",
        holderCount: 128,
        nextCursor: null as string | null,
        _mock: true as boolean | undefined,
      };
    }
    const largest = await this.deps.rpc.getTokenLargestAccounts(mint, limit);
    const total = largest.reduce((a, x) => a + Number(x.uiAmount ?? 0), 0) || 1;
    return {
      items: largest.map((x, i) => ({
        rank: i + 1,
        wallet: x.address,
        amount: String(x.uiAmount ?? x.amount),
        pct: (((Number(x.uiAmount ?? 0) / total) * 100) || 0).toFixed(2),
      })),
      totalSupply: String(total),
      holderCount: largest.length,
      nextCursor: null as string | null,
    };
  }

  async trades(mint: string, limit = 25) {
    if (this.deps.config.isMock) {
      const items = Array.from({ length: Math.min(10, limit) }).map((_, i) => ({
        id: `mkt_${i}`,
        side: (i % 2 === 0 ? "buy" : "sell") as "buy" | "sell",
        priceSol: "0.000000028",
        amountToken: String(100000 * (i + 1)),
        amountSol: "0.05",
        trader: "MockTrader1111111111111111111111111111111",
        txSig: null as string | null,
        at: nowIso(new Date(Date.now() - i * 60_000)),
      }));
      return { items, nextCursor: null as string | null, source: "mock", _mock: true as const };
    }
    const coin = await this.getCoin(mint);
    const heliusKey = process.env.HELIUS_API_KEY || this.deps.config.HELIUS_API_KEY || "";
    const result = await fetchMarketTrades({
      mint,
      pairAddress: coin?.pairAddress,
      venue: coin?.venue,
      limit,
      fetcher: this.deps.fetcher,
      rpc: this.deps.rpc,
      heliusApiKey: heliusKey || undefined,
    });
    return result;
  }

  /** Resolve quote venue + curve for execution. */
  async resolveForQuote(mint: string) {
    const coin = await this.getCoin(mint);
    if (!coin) return null;
    const curve = getCurve(this.deps.db, mint);
    return { coin, curve };
  }
}
