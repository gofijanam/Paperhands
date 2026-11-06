import { TokenBucket } from "../lib/ratelimit.js";
import { TtlCache } from "../lib/cache.js";

const BASE = "https://api.geckoterminal.com/api/v2";
const bucket = new TokenBucket(8 / 60, 2); // ~8/min public
const cache = new TtlCache<unknown>(60_000);

export type FetchLike = typeof fetch;

export async function trendingPoolsSolana(fetcher: FetchLike = fetch, limit = 20) {
  return cache.getOrSet(`trending:${limit}`, async () => {
    await bucket.take();
    const res = await fetcher(`${BASE}/networks/solana/trending_pools?page=1`, {
      headers: { accept: "application/json" },
    });
    if (res.status === 429) throw Object.assign(new Error("rate_limited"), { code: "rate_limited" });
    if (!res.ok) throw new Error(`geckoterminal_${res.status}`);
    return res.json();
  }, 45_000);
}

export async function poolOhlcv(
  poolAddress: string,
  timeframe: "minute" | "hour" | "day",
  aggregate: number,
  fetcher: FetchLike = fetch,
) {
  const key = `ohlcv:${poolAddress}:${timeframe}:${aggregate}`;
  return cache.getOrSet(key, async () => {
    await bucket.take();
    const url = `${BASE}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=100&currency=usd`;
    const res = await fetcher(url, { headers: { accept: "application/json" } });
    if (res.status === 429) throw Object.assign(new Error("rate_limited"), { code: "rate_limited" });
    if (!res.ok) throw new Error(`geckoterminal_${res.status}`);
    return res.json();
  }, 30_000);
}

/** Map GT OHLCV list → our candle shape. */
export function mapOhlcv(json: any): Array<{ t: number; o: string; h: string; l: string; c: string; v: string }> {
  const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
  return list.map((row) => ({
    t: row[0],
    o: String(row[1]),
    h: String(row[2]),
    l: String(row[3]),
    c: String(row[4]),
    v: String(row[5]),
  }));
}

export function mapTrendingPools(json: any): Array<{
  mint: string;
  symbol: string;
  name: string;
  priceUsd: string | null;
  volume24hUsd: string | null;
  change24hPct: string | null;
  liquidityUsd: string | null;
  pairAddress: string | null;
}> {
  const data = json?.data ?? [];
  return data.map((p: any) => {
    const attrs = p.attributes ?? {};
    const base = attrs.base_token_address || attrs.address || "";
    // GT pool id like solana_...
    const pairAddress = typeof p.id === "string" ? p.id.replace(/^solana_/, "") : attrs.address ?? null;
    return {
      mint: base || attrs.base_token?.address || "",
      symbol: attrs.name?.split(" / ")?.[0] ?? attrs.base_token_symbol ?? "?",
      name: attrs.name ?? "Unknown",
      priceUsd: attrs.base_token_price_usd != null ? String(attrs.base_token_price_usd) : null,
      volume24hUsd: attrs.volume_usd?.h24 != null ? String(attrs.volume_usd.h24) : null,
      change24hPct: attrs.price_change_percentage?.h24 != null ? String(attrs.price_change_percentage.h24) : null,
      liquidityUsd: attrs.reserve_in_usd != null ? String(attrs.reserve_in_usd) : null,
      pairAddress,
    };
  });
}
