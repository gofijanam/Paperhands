import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHealthProbe } from "../src/health/probe.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

describe("upstream health probe", () => {
  it("reports real statuses from mocked adapters", async () => {
    const config = loadConfig({
      PAPERHANDS_MODE: "live",
      DATABASE_PATH: ":memory:",
      HOST: "127.0.0.1",
      ADMIN_TOKEN: "",
    } as any);
    const db = openDb(config);
    let dsCalls = 0;
    let gtCalls = 0;
    let jupCalls = 0;
    const probe = createHealthProbe(config, undefined, fetch, {
      fetchDexScreener: async () => {
        dsCalls++;
        return { ok: true, status: 200 };
      },
      fetchGeckoTerminal: async () => {
        gtCalls++;
        return { ok: false, status: 429 };
      },
      fetchJupiter: async () => {
        jupCalls++;
        return { ok: false, status: 500 };
      },
      fetchRpc: async () => "up",
      fetchPumpportal: async () => "up",
    });
    // helius skipped without rpc unless we force — set via tick after overriding
    probe.status.helius = "unknown";
    await probe.tick(["dexscreener", "geckoterminal", "jupiter", "pumpportal"]);
    expect(probe.snapshot().dexscreener).toBe("up");
    expect(probe.snapshot().geckoterminal).toBe("degraded");
    expect(probe.snapshot().jupiter).toBe("degraded");
    expect(probe.snapshot().pumpportal).toBe("up");
    expect(dsCalls).toBe(1);
    expect(gtCalls).toBe(1);
    expect(jupCalls).toBe(1);

    const app = createApp({ config, db, health: probe });
    const j: any = await (await app.request("/v1/health")).json();
    expect(j.upstream.dexscreener).toBe("up");
    expect(j.upstream.geckoterminal).toBe("degraded");
    expect(j.upstream.jupiter).toBe("degraded");
  });

  it("mock mode keeps upstream skipped until probed", async () => {
    const config = loadConfig({ PAPERHANDS_MODE: "mock", DATABASE_PATH: ":memory:" });
    const probe = createHealthProbe(config);
    expect(probe.snapshot().dexscreener).toBe("skipped");
    const app = createApp({ config, db: openDb(config), health: probe });
    const j: any = await (await app.request("/v1/health")).json();
    expect(j.upstream.dexscreener).toBe("skipped");
  });
});
