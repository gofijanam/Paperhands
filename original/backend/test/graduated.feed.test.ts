import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { CatalogService } from "../src/services/catalog.js";

describe("graduated feed cold start", () => {
  it("seeds from DexScreener pumpswap fixture when feed empty", async () => {
    const config = loadConfig({ PAPERHANDS_MODE: "live", DATABASE_PATH: ":memory:" });
    const db = openDb(config);
    const dsSearch = readFileSync("fixtures/upstream/dexscreener_search_bonk.json", "utf8");
    // Force dexId pumpswap for fallback filter
    const patched = JSON.parse(dsSearch);
    for (const p of patched.pairs) p.dexId = "pumpswap";
    const gtTrend = readFileSync("fixtures/upstream/geckoterminal_trending.json", "utf8");
    const fetcher = async (input: any) => {
      const url = String(input);
      if (url.includes("/latest/dex/search")) return new Response(JSON.stringify(patched), { status: 200 });
      if (url.includes("trending_pools")) return new Response(gtTrend, { status: 200 });
      if (url.includes("/tokens/v1/solana")) return new Response(JSON.stringify(patched.pairs), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const catalog = new CatalogService({ config, db, fetcher: fetcher as any });
    const items = await catalog.feed("graduated", 10);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x) => x.venue === "graduated")).toBe(true);
  });
});
