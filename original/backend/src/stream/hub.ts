import { EventEmitter } from "node:events";
import { id, nowIso } from "../lib/ids.js";

export type StreamEvent = {
  v: 1;
  type: string;
  ts: string;
  [k: string]: unknown;
};

export type StreamTicket = {
  ticket: string;
  userId: string | null;
  wallet: string | null;
  expiresAt: number;
  channels: Set<string>;
  mints: Set<string>;
  ip: string | null;
  consumed: boolean;
};

const MAX_MINTS_PER_CONN = 25;
const MAX_CHANNELS = 8;
const TICKET_TTL_MS = 60_000;
const MAX_BUFFERED = 64;
const MAX_CONN_PER_USER = 5;
const MAX_CONN_PER_IP = 20;
const MAX_CONN_GLOBAL = 200;
const MAX_TICKETS = 5_000;
const IDLE_TIMEOUT_MS = 120_000;

export class StreamHub extends EventEmitter {
  private tickets = new Map<string, StreamTicket>();
  private seq = 0;
  private connByUser = new Map<string, number>();
  private connByIp = new Map<string, number>();
  private connGlobal = 0;
  private gcTimer: ReturnType<typeof setInterval>;
  /** Refcounted mint subscriptions (accepted connections only). */
  private watchRef = new Map<string, number>();
  private watchOrder: string[] = [];
  private watchCursor = 0;

  constructor() {
    super();
    this.gcTimer = setInterval(() => this.gcTickets(), 15_000);
    (this.gcTimer as any).unref?.();
  }

  gcTickets() {
    const now = Date.now();
    for (const [k, t] of this.tickets) {
      if (t.consumed || now > t.expiresAt) this.tickets.delete(k);
    }
    if (this.tickets.size > MAX_TICKETS) {
      const sorted = [...this.tickets.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      while (this.tickets.size > MAX_TICKETS && sorted.length) {
        this.tickets.delete(sorted.shift()![0]);
      }
    }
  }

  issueTicket(
    userId: string | null,
    wallet: string | null,
    channels: string[] = [],
    mints: string[] = [],
    ip: string | null = null,
  ): StreamTicket {
    this.gcTickets();
    const ticket = id("tkt_");
    const t: StreamTicket = {
      ticket,
      userId,
      wallet,
      expiresAt: Date.now() + TICKET_TTL_MS,
      channels: new Set(channels.slice(0, MAX_CHANNELS)),
      mints: new Set(mints.slice(0, MAX_MINTS_PER_CONN)),
      ip,
      consumed: false,
    };
    this.tickets.set(ticket, t);
    return t;
  }

  /** Single-use; does not extend TTL. */
  resolveTicket(ticket: string | undefined): StreamTicket | null {
    if (!ticket) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    if (t.consumed || Date.now() > t.expiresAt) {
      this.tickets.delete(ticket);
      return null;
    }
    t.consumed = true;
    this.tickets.delete(ticket);
    return t;
  }

  publish(event: { type: string; ts?: string; [k: string]: unknown }) {
    this.seq += 1;
    const full = {
      v: 1 as const,
      ts: event.ts ?? nowIso(),
      ...event,
      type: event.type,
      seq: this.seq,
    };
    this.emit("event", full);
    return full;
  }

  private tryAcquireConn(userId: string | null, ip: string | null): boolean {
    if (this.connGlobal >= MAX_CONN_GLOBAL) return false;
    if (userId) {
      if ((this.connByUser.get(userId) ?? 0) >= MAX_CONN_PER_USER) return false;
    } else if (ip) {
      // anonymous still capped per IP
      if ((this.connByIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return false;
    } else {
      // no user and no ip: still count global; treat as anonymous bucket
      if ((this.connByUser.get("__anon__") ?? 0) >= MAX_CONN_PER_USER) return false;
    }
    if (ip && (this.connByIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return false;

    this.connGlobal += 1;
    const uk = userId ?? "__anon__";
    this.connByUser.set(uk, (this.connByUser.get(uk) ?? 0) + 1);
    if (ip) this.connByIp.set(ip, (this.connByIp.get(ip) ?? 0) + 1);
    return true;
  }

  private releaseConn(userId: string | null, ip: string | null) {
    this.connGlobal = Math.max(0, this.connGlobal - 1);
    const uk = userId ?? "__anon__";
    const n = (this.connByUser.get(uk) ?? 1) - 1;
    if (n <= 0) this.connByUser.delete(uk);
    else this.connByUser.set(uk, n);
    if (ip) {
      const m = (this.connByIp.get(ip) ?? 1) - 1;
      if (m <= 0) this.connByIp.delete(ip);
      else this.connByIp.set(ip, m);
    }
  }

  addWatches(mints: Iterable<string>) {
    for (const m of mints) {
      if (!m) continue;
      const n = (this.watchRef.get(m) ?? 0) + 1;
      this.watchRef.set(m, n);
      if (n === 1) this.watchOrder.push(m);
      if (this.watchOrder.length > 200) {
        const drop = this.watchOrder.shift();
        if (drop) this.watchRef.delete(drop);
      }
    }
  }

  removeWatches(mints: Iterable<string>) {
    for (const m of mints) {
      const n = (this.watchRef.get(m) ?? 0) - 1;
      if (n <= 0) {
        this.watchRef.delete(m);
        this.watchOrder = this.watchOrder.filter((x) => x !== m);
      } else {
        this.watchRef.set(m, n);
      }
    }
  }

  /** Fair rotation of watched mints (avoid permanent first-40 starvation). */
  getWatchedMintsFair(limit = 40): string[] {
    if (!this.watchOrder.length) return [];
    const out: string[] = [];
    const n = this.watchOrder.length;
    for (let i = 0; i < Math.min(limit, n); i++) {
      const idx = (this.watchCursor + i) % n;
      out.push(this.watchOrder[idx]!);
    }
    this.watchCursor = (this.watchCursor + Math.min(limit, n)) % Math.max(1, n);
    return out;
  }

  createSseStream(opts: {
    channels: Set<string>;
    mints: Set<string>;
    userId: string | null;
    ip?: string | null;
    signal?: AbortSignal;
  }): ReadableStream {
    const { channels, mints, userId } = opts;
    const ip = opts.ip ?? null;
    const cappedMints = new Set([...mints].slice(0, MAX_MINTS_PER_CONN));

    if (!this.tryAcquireConn(userId, ip)) {
      return new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          try {
            controller.enqueue(
              enc.encode(
                `event: error\ndata: ${JSON.stringify({ error: { code: "rate_limited", message: "Too many connections" } })}\n\n`,
              ),
            );
            controller.close();
          } catch {
            /* */
          }
        },
      });
    }

    // F9: only accepted connections register watches
    this.addWatches(cappedMints);

    let closed = false;
    let onEvent: ((ev: StreamEvent & { seq?: number }) => void) | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    // Bounded unread queue — only what the consumer has not yet pulled
    const queue: Uint8Array[] = [];
    let pullWait: (() => void) | null = null;

    const self = this;
    let cleanup = () => {};

    const touchIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => cleanup(), IDLE_TIMEOUT_MS);
    };

    return new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        let seq = 0;

        const push = (bytes: Uint8Array) => {
          if (closed) return;
          // F5: do NOT refresh idle on enqueue/heartbeat — only consumer pull counts
          if (queue.length >= MAX_BUFFERED) {
            cleanup();
            return;
          }
          queue.push(bytes);
          if (pullWait) {
            const w = pullWait;
            pullWait = null;
            w();
          }
        };

        const send = (eventName: string, data: unknown) => {
          if (closed) return;
          seq += 1;
          push(enc.encode(`id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send("heartbeat", { v: 1, type: "heartbeat", ts: nowIso() });

        onEvent = (ev: StreamEvent & { seq?: number }) => {
          const type = ev.type;
          if (type === "price" && channels.has("prices")) {
            if (cappedMints.size && ev.mint && !cappedMints.has(String(ev.mint))) return;
            send("price", ev);
          } else if (type === "feed" && channels.has("feeds")) {
            send("feed", ev);
          } else if (type === "leaderboard" && channels.has("leaderboard")) {
            send("leaderboard", ev);
          } else if (type === "trade_fill" && channels.has("trades")) {
            if (ev.userId && userId && ev.userId === userId) send("trade_fill", ev);
            else if (!ev.userId) send("trade_fill", ev);
          } else if (type === "portfolio" && channels.has("portfolio")) {
            if (ev.userId && userId && ev.userId === userId) send("portfolio", ev);
          } else if (type === "cycle" && channels.has("cycle")) {
            send("cycle", ev);
          } else if (type === "market_trade" && channels.has("trades")) {
            if (cappedMints.size && ev.mint && !cappedMints.has(String(ev.mint))) return;
            send("market_trade", ev);
          }
        };

        hb = setInterval(() => send("heartbeat", { v: 1, type: "heartbeat", ts: nowIso() }), 15_000);
        self.on("event", onEvent);

        cleanup = () => {
          if (closed) return;
          closed = true;
          if (hb) clearInterval(hb);
          if (idleTimer) clearTimeout(idleTimer);
          if (onEvent) self.off("event", onEvent);
          self.removeWatches(cappedMints);
          self.releaseConn(userId, ip);
          if (pullWait) {
            pullWait();
            pullWait = null;
          }
          try {
            controller.close();
          } catch {
            /* */
          }
        };

        if (opts.signal?.aborted) {
          cleanup();
          return;
        }
        opts.signal?.addEventListener("abort", cleanup, { once: true });
        touchIdle();
      },
      async pull(controller) {
        if (closed) return;
        touchIdle(); // consumer activity
        while (!queue.length && !closed) {
          await new Promise<void>((r) => {
            pullWait = r;
          });
        }
        if (closed) return;
        touchIdle();
        const chunk = queue.shift();
        if (chunk) {
          try {
            controller.enqueue(chunk);
          } catch {
            cleanup();
          }
        }
      },
      cancel() {
        cleanup();
      },
    });
  }
}

export const globalHub = new StreamHub();
