/**
 * Opt-in read-only smoke against keyless public APIs.
 * No signing, no transactions, never prints secrets.
 * Usage: npm run smoke:live
 */
import { loadHeliusSecrets } from "../src/lib/secrets.js";
import { searchPairs } from "../src/catalog/dexscreener.js";
import { trendingPoolsSolana, mapTrendingPools } from "../src/catalog/geckoterminal.js";
import { getQuote, WSOL } from "../src/quotes/jupiter.js";

async function main() {
  const helius = loadHeliusSecrets();
  const summary: Record<string, unknown> = {
    at: new Date().toISOString(),
    heliusKeysPresent: helius.keys.length > 0,
    heliusKeyNames: helius.keys,
  };

  try {
    const pairs = await searchPairs("SOL");
    summary.dexscreener = { ok: true, solanaPairs: pairs.length, sample: pairs[0]?.baseToken?.symbol ?? null };
  } catch (e: any) {
    summary.dexscreener = { ok: false, error: String(e.message ?? e) };
  }

  try {
    const gt = await trendingPoolsSolana();
    const mapped = mapTrendingPools(gt);
    summary.geckoterminal = { ok: true, trending: mapped.length, sample: mapped[0]?.symbol ?? null };
  } catch (e: any) {
    summary.geckoterminal = { ok: false, error: String(e.message ?? e) };
  }

  try {
    const q = await getQuote({
      inputMint: WSOL,
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      amount: "100000000", // 0.1 SOL
      slippageBps: 50,
    });
    summary.jupiter = { ok: true, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct };
  } catch (e: any) {
    summary.jupiter = { ok: false, error: String(e.message ?? e) };
  }

  // Optional read-only RPC balance of system program — proves RPC works without revealing key
  if (process.env.HELIUS_API_KEY || process.env.HELIUS_RPC_URL) {
    try {
      const { createRpcClient } = await import("../src/rpc/client.js");
      const { loadConfig } = await import("../src/config.js");
      const rpc = createRpcClient(loadConfig({ ...process.env, PAPERHANDS_MODE: "live" }));
      const slot = await rpc.call<number>("getSlot", []);
      summary.heliusRpc = { ok: true, slot, url: rpc.url };
    } catch (e: any) {
      summary.heliusRpc = { ok: false, error: String(e.message ?? e) };
    }
  } else {
    summary.heliusRpc = { ok: false, error: "no_helius_env" };
  }

  console.log(JSON.stringify({ level: "info", msg: "smoke:live", summary }, null, 2));
  const failed = ["dexscreener", "geckoterminal", "jupiter"].some((k) => (summary as any)[k]?.ok === false);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "error", msg: "smoke failed", error: String(e) }));
  process.exit(1);
});
