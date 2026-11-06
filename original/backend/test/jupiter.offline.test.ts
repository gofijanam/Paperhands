import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getQuote, WSOL } from "../src/quotes/jupiter.js";

describe("jupiter quote (offline)", () => {
  it("returns fixture and coalesces", async () => {
    const body = readFileSync("fixtures/upstream/jupiter_quote.json", "utf8");
    let hits = 0;
    const fetcher = async () => {
      hits += 1;
      return new Response(body, { status: 200 });
    };
    const a = getQuote({
      inputMint: WSOL,
      outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      amount: "100000000",
      slippageBps: 100,
      fetcher: fetcher as any,
    });
    const b = getQuote({
      inputMint: WSOL,
      outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      amount: "100000000",
      slippageBps: 100,
      fetcher: fetcher as any,
    });
    const [qa, qb] = await Promise.all([a, b]);
    expect(qa.outAmount).toBe("8000000000000");
    expect(qb.outAmount).toBe(qa.outAmount);
    expect(hits).toBe(1); // coalesced
  });
});
