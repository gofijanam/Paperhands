import type { Config } from "../config.js";
import { TokenBucket, RateLimitError } from "../lib/ratelimit.js";
import { TtlCache } from "../lib/cache.js";

export type FetchLike = typeof fetch;

export type RpcClient = {
  url: string;
  call: <T>(method: string, params: unknown[]) => Promise<T>;
  getTokenBalanceUi: (wallet: string, mint: string, opts?: { force?: boolean }) => Promise<string>;
  getTokenLargestAccounts: (mint: string, limit?: number) => Promise<Array<{ address: string; amount: string; uiAmount: number | null }>>;
  getAccountInfoBase64: (pubkey: string) => Promise<Buffer | null>;
};

export function resolveRpcUrl(config: Config): string {
  if (config.SOLANA_RPC_URL) return config.SOLANA_RPC_URL;
  if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL;
  if (config.HELIUS_API_KEY || process.env.HELIUS_API_KEY) {
    const key = config.HELIUS_API_KEY || process.env.HELIUS_API_KEY || "";
    return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

export function createRpcClient(config: Config, fetcher: FetchLike = fetch): RpcClient {
  const url = resolveRpcUrl(config);
  // Free Helius ~10 RPS — stay under
  const bucket = new TokenBucket(8, 8);
  const acctCache = new TtlCache<Buffer | null>(5_000);
  const balCache = new TtlCache<string>(config.HOLD_CACHE_TTL_SEC * 1000);
  const holdersCache = new TtlCache<Array<{ address: string; amount: string; uiAmount: number | null }>>(30_000);

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    await bucket.take();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429) {
        if (attempt >= 4) throw new RateLimitError(2);
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`rpc_http_${res.status}`);
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc_error");
      return json.result as T;
    }
  }

  return {
    url: url.replace(/api-key=[^&]+/i, "api-key=REDACTED"),
    call,
    async getTokenBalanceUi(wallet, mint, opts?: { force?: boolean }) {
      const key = `${wallet}:${mint}`;
      if (!opts?.force) {
        const hit = balCache.get(key);
        if (hit !== undefined) return hit;
      }
      const result = await call<{
        value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString?: string; uiAmount?: number } } } } } }>;
      }>("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
      let total = 0;
      for (const a of result?.value ?? []) {
        const ta = a.account.data.parsed.info.tokenAmount;
        total += Number(ta.uiAmountString ?? ta.uiAmount ?? 0);
      }
      const s = String(total);
      balCache.set(key, s);
      return s;
    },
    async getTokenLargestAccounts(mint, limit = 20) {
      const hit = holdersCache.get(mint);
      if (hit) return hit.slice(0, limit);
      const result = await call<{ value: Array<{ address: string; amount: string; uiAmount: number | null }> }>(
        "getTokenLargestAccounts",
        [mint],
      );
      const items = result?.value ?? [];
      holdersCache.set(mint, items);
      return items.slice(0, limit);
    },
    async getAccountInfoBase64(pubkey) {
      const hit = acctCache.get(pubkey);
      if (hit !== undefined) return hit;
      const result = await call<{ value: { data: [string, string] } | null }>("getAccountInfo", [
        pubkey,
        { encoding: "base64" },
      ]);
      const buf = result?.value?.data?.[0] ? Buffer.from(result.value.data[0], "base64") : null;
      acctCache.set(pubkey, buf);
      return buf;
    },
  };
}
