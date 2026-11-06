import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CoinSummaryT } from "../contracts.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");

export function loadMockCoins(): CoinSummaryT[] {
  const raw = JSON.parse(readFileSync(path.join(root, "coins.json"), "utf8")) as CoinSummaryT[];
  return raw;
}

export function mockCandles(mint: string, n = 48) {
  const now = Math.floor(Date.now() / 1000);
  const candles = [];
  let price = mint.includes("Bond") ? 0.000005 : 0.002;
  for (let i = n; i >= 0; i--) {
    const t = now - i * 300;
    const o = price;
    const c = price * (1 + (Math.sin(i / 3) * 0.02));
    const h = Math.max(o, c) * 1.01;
    const l = Math.min(o, c) * 0.99;
    candles.push({
      t,
      o: o.toPrecision(6),
      h: h.toPrecision(6),
      l: l.toPrecision(6),
      c: c.toPrecision(6),
      v: String(1000 + (i % 7) * 120),
    });
    price = c;
  }
  return candles;
}
