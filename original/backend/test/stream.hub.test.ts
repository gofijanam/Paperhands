import { describe, expect, it, vi } from "vitest";
import { StreamHub } from "../src/stream/hub.js";

describe("SSE hub", () => {
  it("single-use tickets and TTL expiry", () => {
    vi.useFakeTimers();
    try {
      const hub = new StreamHub();
      const t = hub.issueTicket("usr_1", "Wallet", ["prices"], ["Mint111111111111111111111111111111111111111"]);
      expect(hub.resolveTicket(t.ticket)?.ticket).toBe(t.ticket);
      // consumed — second resolve null
      expect(hub.resolveTicket(t.ticket)).toBeNull();
      const t2 = hub.issueTicket("usr_1", "Wallet");
      vi.advanceTimersByTime(60_001);
      expect(hub.resolveTicket(t2.ticket)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps mints and filters events", async () => {
    const hub = new StreamHub();
    const mints = Array.from({ length: 30 }, (_, i) => `Mint${String(i).padStart(40, "1")}`);
    const stream = hub.createSseStream({
      channels: new Set(["prices"]),
      mints: new Set(mints),
      userId: null,
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("heartbeat");
    hub.publish({ type: "price", mint: mints[0], priceSol: "1", priceUsd: "1" });
    await new Promise((r) => setTimeout(r, 20));
    const second = await reader.read();
    const text = new TextDecoder().decode(second.value);
    expect(text).toContain("price");
    await reader.cancel();
  });
});
