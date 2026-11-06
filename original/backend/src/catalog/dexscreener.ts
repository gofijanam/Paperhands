/** DexScreener keyless adapter. Limits: 300 rpm pairs/search; 60 rpm profiles. */
import { TokenBucket } from "../lib/ratelimit.js";
import { TtlCache, Coalescer } from "../lib/cache.js";
import type { CoinSummaryT } from "../contracts.js";

const BASE = "https://api.dexscreener.com";
const pairsBucket = new TokenBucket(4, 8); // < 300/min
const profileBucket = new TokenBucket(0.8, 2); // < 60/min
const searchCache = new TtlCache<DsPair[]>(20_000);
const tokenCache = new TtlCache<DsPair[]>(15_000);
const boostCache = new TtlCache<any>(60_000);
const coalescer = new Coalescer<DsPair[]>();

export type FetchLike = typeof fetch;

export type DsPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string; name?: string };
  priceNative?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

async function dsGet(path: string, bucket: TokenBucket, fetcher: FetchLike): Promise<any> {
  await bucket.take();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const res = await fetcher(`${BASE}${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      if (attempt >= 4) throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfterSec: 30 });
      await new Promise((r) => setTimeout(r, 400 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`dexscreener_${res.status}`);
    return res.json();
  }
}

export async function searchPairs(q: string, fetcher: FetchLike = fetch): Promise<DsPair[]> {
  const key = `search:${q.toLowerCase()}`;
  return coalescer.run(key, () =>
    searchCache.getOrSet(key, async () => {
      const json = await dsGet(`/latest/dex/search?q=${encodeURIComponent(q)}`, pairsBucket, fetcher);
      return ((json.pairs ?? []) as DsPair[]).filter((p) => p.chainId === "solana");
    }),
  );
}

export async function tokensByAddress(mints: string[], fetcher: FetchLike = fetch): Promise<DsPair[]> {
  if (!mints.length) return [];
  const key = `tok:${mints.slice(0, 30).join(",")}`;
  return coalescer.run(key, () =>
    tokenCache.getOrSet(key, async () => {
      const json = await dsGet(`/tokens/v1/solana/${mints.slice(0, 30).join(",")}`, pairsBucket, fetcher);
      return (Array.isArray(json) ? json : json.pairs ?? []) as DsPair[];
    }),
  );
}

export async function tokenBoostsTop(fetcher: FetchLike = fetch): Promise<any[]> {
  return boostCache.getOrSet("boosts", async () => {
    const json = await dsGet(`/token-boosts/top/v1`, profileBucket, fetcher);
    return Array.isArray(json) ? json : [];
  });
}

export function pairToSummary(p: DsPair, mintHint?: string): CoinSummaryT {
  const mint = mintHint ?? p.baseToken?.address ?? "";
  const ageSec = p.pairCreatedAt ? Math.max(0, Math.floor((Date.now() - p.pairCreatedAt) / 1000)) : null;
  const liq = p.liquidity?.usd ?? 0;
  const status = liq <= 0 && p.priceUsd === "0" ? ("rugged" as const) : ("tradeable" as const);
  const venue = p.dexId === "pumpfun" || p.dexId === "pump" ? ("bonding" as const) : ("graduated" as const);
  const riskBadges: string[] = [];
  if (ageSec != null && ageSec < 3600) riskBadges.push("new_mint");
  if (status === "rugged") riskBadges.push("rugged", "no_liquidity");
  return {
    mint,
    symbol: p.baseToken?.symbol ?? "?",
    name: p.baseToken?.name ?? "Unknown",
    decimals: 6,
    imageUrl: p.info?.imageUrl ?? null,
    venue,
    status,
    priceSol: p.priceNative ?? null,
    priceUsd: p.priceUsd ?? null,
    liquidityUsd: p.liquidity?.usd != null ? String(p.liquidity.usd) : null,
    marketCapUsd: p.marketCap != null ? String(p.marketCap) : p.fdv != null ? String(p.fdv) : null,
    volume24hUsd: p.volume?.h24 != null ? String(p.volume.h24) : null,
    change24hPct: p.priceChange?.h24 != null ? String(p.priceChange.h24) : null,
    ageSec,
    bondingProgressPct: null,
    pairAddress: p.pairAddress ?? null,
    dexId: p.dexId ?? null,
    riskBadges,
  };
}

/** Best pair per mint (highest liquidity). */
export function bestPairsByMint(pairs: DsPair[]): Map<string, DsPair> {
  const map = new Map<string, DsPair>();
  for (const p of pairs) {
    const mint = p.baseToken?.address;
    if (!mint) continue;
    const prev = map.get(mint);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) map.set(mint, p);
  }
  return map;
}
