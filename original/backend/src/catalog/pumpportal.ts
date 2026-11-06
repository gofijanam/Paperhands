/**
 * PumpPortal websocket: free newToken + migration ingest.
 * Persists into curve_state / feed_coins. Never prints secrets.
 */
import { EventEmitter } from "node:events";
import type { Db } from "../db.js";
import type { RpcClient } from "../rpc/client.js";
import type { Config } from "../config.js";
import { fetchCurveState, curveToProgressPct } from "../bonding/onchain.js";
import { initialCurve } from "../bonding/curve.js";
import { upsertCurve, markGraduated, upsertFeedCoin } from "./curveStore.js";
import { nowIso } from "../lib/ids.js";

export type PumpNewToken = {
  mint?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  bondingCurveKey?: string;
  marketCapSol?: number;
  [k: string]: unknown;
};

export class PumpPortalFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private closed = false;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly rpc?: RpcClient,
    apiKey?: string,
  ) {
    super();
    this.url = apiKey ? `wss://pumpportal.fun/api/data?api-key=${apiKey}` : "wss://pumpportal.fun/api/data";
  }

  start() {
    if (this.ws || typeof WebSocket === "undefined") return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws.send(JSON.stringify({ method: "subscribeMigration" }));
      this.emit("open");
    });
    ws.addEventListener("message", (ev) => {
      void this.onMessage(String(ev.data));
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      this.emit("close");
      if (!this.closed) setTimeout(() => this.start(), 3_000);
    });
    ws.addEventListener("error", (e) => this.emit("error", e));
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private async onMessage(raw: string) {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const mint = data.mint as string | undefined;
    if (!mint) return;

    const isMigrate = data.txType === "migrate" || data.pool || data.type === "migration";
    if (isMigrate) {
      markGraduated(this.db, mint, data.symbol, data.name);
      upsertFeedCoin(
        this.db,
        mint,
        "graduated",
        {
          mint,
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
          updatedAt: nowIso(),
        },
        data.symbol,
        data.name,
      );
      this.emit("migration", data);
      return;
    }

    // new token
    let state = initialCurve();
    let progress = 0;
    if (this.rpc) {
      const live = await fetchCurveState(this.rpc, mint);
      if (live) {
        state = live;
        progress = curveToProgressPct(live);
      }
    }
    upsertCurve(this.db, mint, state, {
      symbol: data.symbol,
      name: data.name,
      progressPct: progress,
      graduated: state.complete,
    });
    upsertFeedCoin(
      this.db,
      mint,
      "new",
      {
        mint,
        symbol: data.symbol ?? "?",
        name: data.name ?? "Unknown",
        decimals: 6,
        imageUrl: null,
        venue: "bonding",
        status: "tradeable",
        priceSol: null,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: data.marketCapSol != null ? String(data.marketCapSol) : null,
        volume24hUsd: null,
        change24hPct: null,
        ageSec: 0,
        bondingProgressPct: progress.toFixed(1),
        pairAddress: null,
        dexId: "pumpfun",
        riskBadges: ["new_mint"],
      },
      data.symbol,
      data.name,
    );
    this.emit("newToken", data);
  }
}
