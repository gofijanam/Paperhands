import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { checkHold } from "../src/hold/gate.js";
import type { RpcClient } from "../src/rpc/client.js";

describe("hold gate live path", () => {
  it("reads balance via injected rpc", async () => {
    const config = loadConfig({ PAPERHANDS_MODE: "live", DATABASE_PATH: ":memory:", PAPER_MINT: "FakeMint111111111111111111111111111111111", PAPER_MIN_HOLD: "50000" });
    const db = openDb(config);
    const rpc: RpcClient = {
      url: "redacted",
      call: async () => null as any,
      getTokenBalanceUi: async () => "75000",
      getTokenLargestAccounts: async () => [],
      getAccountInfoBase64: async () => null,
    };
    const hold = await checkHold(db, config, "WalletHoldTest11111111111111111111111111111", { force: true, rpc });
    expect(hold.ok).toBe(true);
    expect(hold.balance).toBe("75000");
    expect(hold.cached).toBe(false);
    const cached = await checkHold(db, config, "WalletHoldTest11111111111111111111111111111", { rpc });
    expect(cached.cached).toBe(true);
  });
});
