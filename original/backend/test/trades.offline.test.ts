import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fetchMarketTrades, mapGtTrades } from "../src/catalog/trades.js";

describe("market trades tape", () => {
  it("maps GT trades fixture", () => {
    const json = JSON.parse(readFileSync("fixtures/upstream/geckoterminal_trades.json", "utf8"));
    const items = mapGtTrades(json, 10);
    expect(items).toHaveLength(2);
    expect(items[0].side).toBe("buy");
    expect(items[0].amountSol).toBe("0.5");
    expect(items[1].side).toBe("sell");
    expect(items[1].txSig).toContain("TxHashMock2");
  });

  it("fetches via injectable fetcher (offline)", async () => {
    const trades = readFileSync("fixtures/upstream/geckoterminal_trades.json", "utf8");
    const pools = readFileSync("fixtures/upstream/geckoterminal_token_pools.json", "utf8");
    const fetcher = async (input: any) => {
      const url = String(input);
      if (url.includes("/trades")) return new Response(trades, { status: 200 });
      if (url.includes("/pools")) return new Response(pools, { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const res = await fetchMarketTrades({
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      limit: 10,
      fetcher: fetcher as any,
    });
    expect(res.source).toBe("geckoterminal");
    expect(res.items.length).toBe(2);
  });
});
