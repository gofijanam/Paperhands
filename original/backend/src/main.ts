import { serve } from "@hono/node-server";
// serve() injects HttpBindings (incoming.socket.remoteAddress) into c.env for peer IP (R2)
import { loadHeliusSecrets } from "./lib/secrets.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createRpcClient } from "./rpc/client.js";
import { PumpPortalFeed } from "./catalog/pumpportal.js";
import { ensureCurveTable } from "./catalog/curveStore.js";
import { CatalogService } from "./services/catalog.js";
import { globalHub } from "./stream/hub.js";
import { startCycleScheduler } from "./cycles/scheduler.js";
import { startPricePoller, seedGraduatedFeed } from "./stream/poller.js";
import { createHealthProbe } from "./health/probe.js";

const helius = loadHeliusSecrets();
const config = loadConfig(process.env);
const db = openDb(config);
ensureCurveTable(db);

const rpc = config.isMock ? undefined : createRpcClient(config);
const catalog = new CatalogService({ config, db, rpc });
const hub = globalHub;
const health = createHealthProbe(config, rpc);
const app = createApp({ config, db, rpc, catalog, hub, health });

// Watched mints come from hub refcount (accepted SSE connections only)
hub.on("event", (ev: any) => {
  if (ev?.type === "price" && ev.mint) {
    /* poller already tracks via hub.getWatchedMintsFair */
  }
});

let portal: PumpPortalFeed | undefined;
const stops: Array<() => void> = [];
stops.push(health.start());

if (!config.isMock) {
  portal = new PumpPortalFeed(db, config, rpc);
  portal.start();
  portal.on("newToken", (data: any) => {
    if (data?.mint) hub.addWatches([String(data.mint)]);
    hub.publish({
      type: "feed",
      kind: "new",
      coin: {
        mint: data.mint,
        symbol: data.symbol ?? "?",
        name: data.name ?? "Unknown",
        decimals: 6,
        imageUrl: null,
        venue: "bonding",
        status: "tradeable",
        priceSol: null,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        change24hPct: null,
        ageSec: 0,
        bondingProgressPct: "0",
        pairAddress: null,
        dexId: "pumpfun",
        riskBadges: ["new_mint"],
      },
    });
  });
  portal.on("migration", (data: any) => {
    if (data?.mint) hub.addWatches([String(data.mint)]);
    hub.publish({
      type: "feed",
      kind: "graduated",
      coin: {
        mint: data.mint,
        symbol: data.symbol ?? "?",
        name: data.name ?? "Unknown",
        decimals: 6,
        imageUrl: null,
        venue: "graduated",
        status: "tradeable",
        priceSol: null,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        change24hPct: null,
        ageSec: 0,
        bondingProgressPct: "100",
        pairAddress: data.pool ?? null,
        dexId: "pumpswap",
        riskBadges: [],
      },
    });
  });
  portal.on("error", () => {});

  stops.push(startCycleScheduler(db, config, hub, catalog, 30_000));
  stops.push(
    startPricePoller({
      config,
      db,
      catalog,
      hub,
      getWatchedMints: () => hub.getWatchedMintsFair(40),
      intervalMs: 5_000,
      leaderboardEveryMs: 15_000,
    }),
  );

  void seedGraduatedFeed(catalog, db, fetch).then((r) => {
    console.log(JSON.stringify({ level: "info", msg: "graduated_feed_seeded", ...r }));
  });
}

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "paperhands api listening",
      host: config.HOST,
      port: info.port,
      mode: config.PAPERHANDS_MODE,
      version: config.version,
      heliusKeysLoaded: helius.keys,
      pumpportal: !config.isMock,
      sse: true,
      cycleScheduler: !config.isMock,
      marketTrade: config.isMock ? "mock" : "disabled",
      heliusTape: config.HELIUS_TAPE_ENABLED === "1" ? "enabled" : "disabled",
    }),
  );
});

process.on("SIGINT", () => {
  portal?.stop();
  for (const s of stops) s();
  server.close();
  process.exit(0);
});
