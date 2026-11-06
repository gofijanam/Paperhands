/** Jupiter quote adapter. Keyless 0.5 RPS on api.jup.ag; optional x-api-key for 1+ RPS. */
import { TokenBucket } from "../lib/ratelimit.js";
import { TtlCache, Coalescer } from "../lib/cache.js";

export const WSOL = "So11111111111111111111111111111111111111112";

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan?: unknown[];
};

export type FetchLike = typeof fetch;

const keylessBucket = new TokenBucket(0.45, 1); // under 0.5 RPS
const keyedBucket = new TokenBucket(0.9, 2); // free key ~1 RPS
const quoteCache = new TtlCache<JupiterQuote>(4_000);
const coalescer = new Coalescer<JupiterQuote>();

export async function getQuote(opts: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  apiKey?: string;
  fetcher?: FetchLike;
}): Promise<JupiterQuote> {
  const fetcher = opts.fetcher ?? fetch;
  const key = [opts.inputMint, opts.outputMint, opts.amount, opts.slippageBps].join(":");
  const cached = quoteCache.get(key);
  if (cached) return cached;

  return coalescer.run(key, async () => {
    const bucket = opts.apiKey ? keyedBucket : keylessBucket;
    await bucket.take();
    const u = new URL("https://api.jup.ag/swap/v1/quote");
    u.searchParams.set("inputMint", opts.inputMint);
    u.searchParams.set("outputMint", opts.outputMint);
    u.searchParams.set("amount", opts.amount);
    u.searchParams.set("slippageBps", String(opts.slippageBps));
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await fetcher(u, { headers });
      if (res.status === 429) {
        if (attempt >= 4) throw Object.assign(new Error("rate_limited"), { code: "rate_limited" });
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw Object.assign(new Error(`jupiter_${res.status}`), { body: t.slice(0, 200), code: "upstream_degraded" });
      }
      const q = (await res.json()) as JupiterQuote;
      quoteCache.set(key, q);
      return q;
    }
  });
}
