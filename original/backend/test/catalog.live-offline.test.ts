import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { CatalogService } from "../src/services/catalog.js";
import { upsertCurve } from "../src/catalog/curveStore.js";
import { initialCurve } from "../src/bonding/curve.js";

function fixtureFetcher(map: Record<string, string>): typeof fetch {
  return async (input: any) => {
    const url = String(input);
    for (const [needle, file] of Object.entries(map)) {
      if (url.includes(needle)) {
        const body = readFileSync(file, "utf8");
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: "unmocked " + url }), { status: 500 });
  };
}

describe("catalog live (offline fixtures)", () => {
  const config = loadConfig({ PAPERHANDS_MODE: "live", DATABASE_PATH: ":memory:", GRADUATING_PCT: "80" });
  const db = openDb(config);

  it("searches via DexScreener fixture", async () => {
    const fetcher = fixtureFetcher({
      "/latest/dex/search": "fixtures/upstream/dexscreener_search_bonk.json",
    });
    const catalog = new CatalogService({ config, db, fetcher: fetcher as any });
    const items = await catalog.search("BONK", 10);
    expect(items[0].symbol).toBe("BONK");
    expect(items[0].venue).toBe("graduated");
  });

  it("trending via GeckoTerminal fixture", async () => {
    const fetcher = fixtureFetcher({
      "trending_pools": "fixtures/upstream/geckoterminal_trending.json",
      "/tokens/v1/solana": "fixtures/upstream/dexscreener_search_bonk.json",
    });
    // tokensByAddress expects array — provide pairs list shape
    const catalog = new CatalogService({ config, db, fetcher: fetcher as any });
    const items = await catalog.feed("trending", 5);
    expect(items.length).toBeGreaterThan(0);
  });

  it("about_to_graduate from persisted curve state", async () => {
    const curve = initialCurve();
    // simulate ~85% sold
    const sold = (curve.realTokenReserves * 85n) / 100n;
    curve.realTokenReserves = curve.realTokenReserves - sold;
    upsertCurve(db, "NearGradMint111111111111111111111111111111", curve, {
      symbol: "NEAR",
      name: "Near",
      progressPct: 85,
    });
    const catalog = new CatalogService({ config, db, fetcher: (async () => new Response("{}")) as any });
    const items = await catalog.feed("about_to_graduate", 10);
    expect(items.some((x) => x.mint.startsWith("NearGrad"))).toBe(true);
  });
});
