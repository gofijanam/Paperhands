/**
 * Background upstream health probes — cheap, rate-limit-aware.
 * Updates a shared status map consumed by GET /v1/health.
 */
import type { Config } from "../config.js";
import type { RpcClient } from "../rpc/client.js";
import { WSOL } from "../quotes/jupiter.js";
import { nowIso } from "../lib/ids.js";

export type UpstreamStatus = "up" | "down" | "degraded" | "unknown" | "skipped";

export type UpstreamHealth = {
  dexscreener: UpstreamStatus;
  jupiter: UpstreamStatus;
  helius: UpstreamStatus;
  pumpportal: UpstreamStatus;
  geckoterminal: UpstreamStatus;
  birdeye: UpstreamStatus;
};

export type ProbeAdapters = {
  fetchDexScreener?: () => Promise<Response | { ok: boolean; status: number }>;
  fetchGeckoTerminal?: () => Promise<Response | { ok: boolean; status: number }>;
  fetchJupiter?: () => Promise<Response | { ok: boolean; status: number }>;
  fetchRpc?: () => Promise<"up" | "down" | "degraded">;
  fetchPumpportal?: () => Promise<"up" | "down" | "degraded" | "skipped">;
};

const INTERVALS_MS = {
  dexscreener: 60_000,
  geckoterminal: 90_000,
  jupiter: 120_000,
  helius: 30_000,
  pumpportal: 120_000,
  birdeye: 300_000,
} as const;

function initial(config: Config, rpc?: RpcClient): UpstreamHealth {
  return {
    dexscreener: config.isMock ? "skipped" : "unknown",
    jupiter: config.isMock ? "skipped" : "unknown",
    helius: config.isMock || !rpc ? "skipped" : "unknown",
    pumpportal: config.isMock ? "skipped" : "unknown",
    geckoterminal: config.isMock ? "skipped" : "unknown",
    birdeye: !config.BIRDEYE_API_KEY ? "skipped" : config.isMock ? "skipped" : "unknown",
  };
}

function classifyHttp(res: { ok: boolean; status: number }): UpstreamStatus {
  if (res.ok) return "up";
  if (res.status === 429) return "degraded";
  if (res.status >= 500) return "degraded";
  return "down";
}

export class HealthProbe {
  readonly status: UpstreamHealth;
  private timers: NodeJS.Timeout[] = [];
  private lastRun: Partial<Record<keyof UpstreamHealth, string>> = {};
  private stopped = false;

  constructor(
    private config: Config,
    private rpc: RpcClient | undefined,
    private fetcher: typeof fetch = fetch,
    private adapters: ProbeAdapters = {},
  ) {
    this.status = initial(config, rpc);
  }

  snapshot(): UpstreamHealth {
    return { ...this.status };
  }

  lastChecked(): Partial<Record<keyof UpstreamHealth, string>> {
    return { ...this.lastRun };
  }

  /** One full probe pass (used by tests and the first tick). */
  async tick(targets?: Array<keyof UpstreamHealth>): Promise<void> {
    const all: Array<keyof UpstreamHealth> = targets ?? [
      "dexscreener",
      "geckoterminal",
      "jupiter",
      "helius",
      "pumpportal",
      "birdeye",
    ];
    await Promise.all(all.map((t) => this.probeOne(t)));
  }

  start(): () => void {
    if (this.config.isMock) {
      // mock: leave skipped; still allow manual tick in tests
      return () => this.stop();
    }
    void this.tick();
    const schedule = (key: keyof typeof INTERVALS_MS, fn: () => void) => {
      const h = setInterval(fn, INTERVALS_MS[key]);
      this.timers.push(h);
    };
    schedule("dexscreener", () => void this.probeOne("dexscreener"));
    schedule("geckoterminal", () => void this.probeOne("geckoterminal"));
    schedule("jupiter", () => void this.probeOne("jupiter"));
    schedule("helius", () => void this.probeOne("helius"));
    schedule("pumpportal", () => void this.probeOne("pumpportal"));
    if (this.config.BIRDEYE_API_KEY) {
      schedule("birdeye", () => void this.probeOne("birdeye"));
    }
    return () => this.stop();
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async probeOne(key: keyof UpstreamHealth) {
    if (this.stopped) return;
    if (this.status[key] === "skipped") return;
    try {
      switch (key) {
        case "dexscreener": {
          const res = this.adapters.fetchDexScreener
            ? await this.adapters.fetchDexScreener()
            : await this.fetcher("https://api.dexscreener.com/token-boosts/top/v1", {
                headers: { accept: "application/json" },
              });
          this.status.dexscreener = classifyHttp(res);
          break;
        }
        case "geckoterminal": {
          const res = this.adapters.fetchGeckoTerminal
            ? await this.adapters.fetchGeckoTerminal()
            : await this.fetcher("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1", {
                headers: { accept: "application/json" },
              });
          this.status.geckoterminal = classifyHttp(res);
          break;
        }
        case "jupiter": {
          const res = this.adapters.fetchJupiter
            ? await this.adapters.fetchJupiter()
            : await this.fetcher(
                `https://api.jup.ag/swap/v1/quote?inputMint=${WSOL}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50`,
                { headers: { accept: "application/json" } },
              );
          this.status.jupiter = classifyHttp(res);
          break;
        }
        case "helius": {
          if (this.adapters.fetchRpc) {
            this.status.helius = await this.adapters.fetchRpc();
          } else if (this.rpc) {
            try {
              await this.rpc.call("getSlot", []);
              this.status.helius = "up";
            } catch (e: any) {
              this.status.helius = e?.code === "rate_limited" ? "degraded" : "down";
            }
          } else {
            this.status.helius = "skipped";
          }
          break;
        }
        case "pumpportal": {
          if (this.adapters.fetchPumpportal) {
            this.status.pumpportal = await this.adapters.fetchPumpportal();
          } else {
            // Lightweight: DNS/HTTP upgrade check is heavy; treat configured live mode as unknown until WS reports.
            // Probe the public docs/health-less endpoint via a short websocket is out of scope — mark degraded only on prior errors.
            // Use a cheap HEAD-less GET to pumpportal API root if any; otherwise leave previous or unknown→up soft.
            try {
              const res = await this.fetcher("https://pumpportal.fun/", { method: "HEAD" }).catch(() => null);
              if (!res) this.status.pumpportal = "degraded";
              else this.status.pumpportal = res.ok || res.status === 405 || res.status === 404 ? "up" : classifyHttp(res);
            } catch {
              this.status.pumpportal = "degraded";
            }
          }
          break;
        }
        case "birdeye": {
          if (!this.config.BIRDEYE_API_KEY) {
            this.status.birdeye = "skipped";
            break;
          }
          const res = await this.fetcher("https://public-api.birdeye.so/defi/networks", {
            headers: { accept: "application/json", "X-API-KEY": this.config.BIRDEYE_API_KEY },
          });
          this.status.birdeye = classifyHttp(res);
          break;
        }
      }
    } catch (e: any) {
      const code = e?.code;
      if (code === "rate_limited") {
        (this.status as any)[key] = "degraded";
      } else {
        (this.status as any)[key] = "down";
      }
      console.error(JSON.stringify({ level: "error", msg: "health_probe_failed", upstream: key, detail: String(e?.message ?? e).slice(0, 120) }));
    }
    this.lastRun[key] = nowIso();
  }
}

export function createHealthProbe(
  config: Config,
  rpc?: RpcClient,
  fetcher: typeof fetch = fetch,
  adapters: ProbeAdapters = {},
) {
  return new HealthProbe(config, rpc, fetcher, adapters);
}
