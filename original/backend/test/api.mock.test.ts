import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const WALLET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // valid base58 32-byte

describe("mock API", () => {
  const config = loadConfig({
    ...process.env,
    PAPERHANDS_MODE: "mock",
    HOST: "127.0.0.1",
    PORT: "8807",
    ADMIN_TOKEN: "test-admin",
  });
  const db = openDb(config);
  const app = createApp({ config, db });
  let token = "";

  it("health", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.mode).toBe("mock");
  });

  it("siws mock verify", async () => {
    const n = (await (await app.request(`/v1/auth/nonce?wallet=${WALLET}`)).json()) as any;
    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: WALLET, message: n.message, signature: "MOCK_SIG" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.user.hold.ok).toBe(true);
    token = j.accessToken;
  });

  it("feeds + search", async () => {
    const f = (await (await app.request("/v1/feeds/trending")).json()) as any;
    expect(f.items.length).toBeGreaterThan(0);
    const s = (await (await app.request("/v1/coins/search?q=PAPERDOG")).json()) as any;
    expect(s.items[0].symbol).toBe("PAPERDOG");
  });

  it("quote and trade", async () => {
    const mint = "PumpBondMock11111111111111111111111111111";
    const qRes = await app.request("/v1/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ mint, side: "buy", amountSol: "0.5", slippageBps: 500 }),
    });
    expect(qRes.status).toBe(200);
    const q = (await qRes.json()) as any;
    const tRes = await app.request("/v1/trades", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": "00000000-0000-0000-0000-000000000001",
      },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(tRes.status).toBe(201);
    const t = (await tRes.json()) as any;
    expect(t.trade.status).toBe("filled");
    expect(Number(t.portfolio.cashSol)).toBeLessThan(10);
  });

  it("portfolio + leaderboard", async () => {
    const p = (await (
      await app.request("/v1/portfolio", { headers: { authorization: `Bearer ${token}` } })
    ).json()) as any;
    expect(p.positions.length).toBeGreaterThanOrEqual(1);
    const lb = (await (await app.request("/v1/leaderboard")).json()) as any;
    expect(lb.items.length).toBeGreaterThan(0);
  });

  it("admin payout queue marks only", async () => {
    const gen = await app.request("/v1/admin/payouts/generate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
      body: JSON.stringify({ topN: 3 }),
    });
    expect(gen.status).toBe(201);
    const list = (await (
      await app.request("/v1/admin/payouts", { headers: { authorization: "Bearer test-admin" } })
    ).json()) as any;
    expect(list.items.length).toBeGreaterThan(0);
    const id = list.items[0].id;
    const patch = await app.request(`/v1/admin/payouts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
      body: JSON.stringify({ status: "paid", txRef: "offchain-manual-ref", note: "paid outside app" }),
    });
    expect(patch.status).toBe(200);
  });
});
