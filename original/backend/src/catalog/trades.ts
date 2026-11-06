/**
 * Market tape: GeckoTerminal pool trades (keyless, documented) as primary.
 * Resolves pool via coin.pairAddress or GT /tokens/{mint}/pools.
 * Optional Helius parsed-events history on bonding-curve PDA as bonding fallback.
 */
import { TokenBucket } from "../lib/ratelimit.js";
import { TtlCache, Coalescer } from "../lib/cache.js";
import type { RpcClient } from "../rpc/client.js";
import { bondingCurvePda } from "../bonding/onchain.js";

const BASE = "https://api.geckoterminal.com/api/v2";
const bucket = new TokenBucket(8 / 60, 2);
const cache = new TtlCache<{ items: MarketTrade[]; nextCursor: string | null; source: string }>(15_000);
const coalescer = new Coalescer<{ items: MarketTrade[]; nextCursor: string | null; source: string }>();

export type FetchLike = typeof fetch;

export type MarketTrade = {
  id: string;
  side: "buy" | "sell";
  priceSol: string;
  amountToken: string;
  amountSol: string;
  trader: string | null;
  txSig: string | null;
  at: string;
};

async function gtGet(path: string, fetcher: FetchLike): Promise<any> {
  await bucket.take();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const res = await fetcher(`${BASE}${path}`, {
      headers: { accept: "application/json;version=20230203" },
    });
    if (res.status === 429) {
      if (attempt >= 4) throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfterSec: 30 });
      await new Promise((r) => setTimeout(r, 400 * attempt));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`geckoterminal_${res.status}`), { code: "upstream_degraded" });
    return res.json();
  }
}

export async function resolvePoolAddress(mint: string, hint: string | null | undefined, fetcher: FetchLike): Promise<string | null> {
  if (hint) return hint;
  try {
    const json = await gtGet(`/networks/solana/tokens/${mint}/pools`, fetcher);
    const pools = json?.data ?? [];
    if (!pools.length) return null;
    // Prefer highest reserve
    pools.sort(
      (a: any, b: any) =>
        Number(b.attributes?.reserve_in_usd ?? 0) - Number(a.attributes?.reserve_in_usd ?? 0),
    );
    return pools[0]?.attributes?.address ?? pools[0]?.id?.replace(/^solana_/, "") ?? null;
  } catch {
    return null;
  }
}

const SOL_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
]);

function isSolAsset(addr: unknown): boolean {
  if (addr == null) return false;
  const s = String(addr);
  if (SOL_MINTS.has(s)) return true;
  const lower = s.toLowerCase();
  return lower === "sol" || lower === "wsol";
}

/**
 * Map GeckoTerminal trades.
 * Only treat the quote leg as SOL when the pool/trade quote asset is SOL/WSOL.
 * Non-SOL quotes (USDC, etc.) → amountSol and priceSol are "" (unknown), never fabricated.
 */
export function mapGtTrades(
  json: any,
  limit: number,
  opts?: { quoteIsSol?: boolean },
): MarketTrade[] {
  const data = json?.data ?? [];
  const out: MarketTrade[] = [];
  for (const row of data.slice(0, limit)) {
    const a = row.attributes ?? {};
    const kind = (a.kind === "sell" ? "sell" : "buy") as "buy" | "sell";
    const fromAddr = a.from_token_address ?? a.currency_from ?? null;
    const toAddr = a.to_token_address ?? a.currency_to ?? null;
    const quoteAddr = kind === "buy" ? fromAddr : toAddr;

    let quoteIsSol: boolean;
    if (opts?.quoteIsSol === true) quoteIsSol = true;
    else if (opts?.quoteIsSol === false) quoteIsSol = false;
    else if (quoteAddr != null) quoteIsSol = isSolAsset(quoteAddr);
    else quoteIsSol = true; // no orientation metadata → legacy SOL-pool assumption (GT SOL pairs)

    const amountToken =
      kind === "buy" ? String(a.to_token_amount ?? "0") : String(a.from_token_amount ?? "0");

    let amountSol = "";
    let priceSol = "";
    if (quoteIsSol) {
      amountSol = kind === "buy" ? String(a.from_token_amount ?? "0") : String(a.to_token_amount ?? "0");
      priceSol =
        kind === "buy"
          ? String(a.price_to_in_currency_token ?? a.price_from_in_currency_token ?? "0")
          : String(a.price_from_in_currency_token ?? "0");
    }

    out.push({
      id: String(row.id ?? a.tx_hash ?? `mkt_${out.length}`),
      side: kind,
      priceSol,
      amountToken,
      amountSol,
      trader: a.tx_from_address ?? null,
      txSig: a.tx_hash ?? null,
      at: a.block_timestamp ?? new Date().toISOString(),
    });
  }
  return out;
}


export async function fetchPoolTrades(
  poolAddress: string,
  limit: number,
  fetcher: FetchLike,
): Promise<{ items: MarketTrade[]; nextCursor: string | null; source: string }> {
  const key = `trades:${poolAddress}:${limit}`;
  return coalescer.run(key, () =>
    cache.getOrSet(key, async () => {
      const json = await gtGet(
        `/networks/solana/pools/${poolAddress}/trades?trade_volume_in_usd_greater_than=0`,
        fetcher,
      );
      return { items: mapGtTrades(json, limit), nextCursor: null, source: "geckoterminal" };
    }),
  );
}

/** Helius Parsed Events transaction-history on bonding-curve PDA (bonding fallback). */
export async function fetchBondingTradesViaHelius(
  rpc: RpcClient,
  mint: string,
  limit: number,
  apiKey: string,
): Promise<{ items: MarketTrade[]; nextCursor: string | null; source: string }> {
  const key = `helius_trades:${mint}:${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pda = bondingCurvePda(mint);
  const base = process.env.HELIUS_RPC_URL?.replace(/\?.*$/, "") || "https://mainnet.helius-rpc.com";
  // Credential via header only — never place api-key in the URL (P2-07 / K3).
  // NOTE: live header-auth probe returned HTTP 404; keep behind HELIUS_TAPE_ENABLED.
  const url = `${base}/v1/parsed-events/transaction-history`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ address: pda, commitment: "confirmed", limit: Math.min(100, limit) }),
  });
  if (res.status === 429) throw Object.assign(new Error("rate_limited"), { code: "rate_limited" });
  if (!res.ok) {
    // Soft-fail to empty rather than break the page
    return { items: [], nextCursor: null, source: "helius_parsed_events" };
  }
  const json = (await res.json()) as any;
  const rows = Array.isArray(json) ? json : json?.result ?? json?.data ?? [];
  const items: MarketTrade[] = [];
  for (const row of rows.slice(0, limit)) {
    const sig = row.signature ?? row.transaction?.signatures?.[0] ?? null;
    const ts = row.timestamp
      ? new Date(row.timestamp * (row.timestamp < 1e12 ? 1000 : 1)).toISOString()
      : row.blockTime
        ? new Date(row.blockTime * 1000).toISOString()
        : new Date().toISOString();
    const typ = String(row.type ?? row.transactionType ?? "").toLowerCase();
    const side: "buy" | "sell" = typ.includes("sell") ? "sell" : "buy";
    // Parse real amounts from parsed events when present; otherwise omit (empty) — never fabricate
    const ev = row.events ?? row.tokenTransfers ?? row.nativeTransfers ?? null;
    let amountToken = "";
    let amountSol = "";
    let priceSol = "";
    if (Array.isArray(row.tokenTransfers)) {
      const tok = row.tokenTransfers.find((t: any) => t.mint === mint);
      if (tok?.tokenAmount != null) amountToken = String(tok.tokenAmount);
    }
    if (Array.isArray(row.nativeTransfers) && row.nativeTransfers.length) {
      const lamports = Number(row.nativeTransfers[0].amount ?? 0);
      if (Number.isFinite(lamports) && lamports > 0) amountSol = String(lamports / 1e9);
    }
    // If we cannot parse real amounts, leave blank rather than "0" fabrication pretending knowledge
    items.push({
      id: sig ?? `mkt_${items.length}`,
      side,
      priceSol,
      amountToken,
      amountSol,
      trader: row.feePayer ?? row.source ?? null,
      txSig: sig,
      at: ts,
    });
  }
  const out = { items, nextCursor: null as string | null, source: "helius_parsed_events" };
  cache.set(key, out);
  return out;
}

export async function fetchMarketTrades(opts: {
  mint: string;
  pairAddress?: string | null;
  venue?: string;
  limit?: number;
  fetcher?: FetchLike;
  rpc?: RpcClient;
  heliusApiKey?: string;
  heliusTapeEnabled?: boolean;
}): Promise<{ items: MarketTrade[]; nextCursor: string | null; source: string }> {
  const limit = Math.min(100, opts.limit ?? 25);
  const fetcher = opts.fetcher ?? fetch;
  const pool = await resolvePoolAddress(opts.mint, opts.pairAddress, fetcher);
  if (pool) {
    try {
      return await fetchPoolTrades(pool, limit, fetcher);
    } catch (e: any) {
      if (e.code === "rate_limited") throw e;
      // fall through
    }
  }
  // K3: Helius tape disabled by default (header auth → 404; query-key forbidden in logs).
  // Enable only with HELIUS_TAPE_ENABLED=1 after a verified endpoint/auth contract.
  const heliusTapeOn = process.env.HELIUS_TAPE_ENABLED === "1" || opts.heliusTapeEnabled === true;
  if (heliusTapeOn && opts.venue === "bonding" && opts.heliusApiKey && opts.rpc) {
    return fetchBondingTradesViaHelius(opts.rpc, opts.mint, limit, opts.heliusApiKey);
  }
  return {
    items: [],
    nextCursor: null,
    source: heliusTapeOn ? "none" : "helius_disabled",
  };
}
