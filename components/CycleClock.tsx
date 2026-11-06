"use client";
import type { TCycle } from "@/lib/api";
import { Countdown } from "./Countdown";
import { useNow } from "@/lib/live";

/** Cycle end countdown, or the settling state (CONTRACT fbdabef: /cycles/current may be `settling` until its successor opens). */
export function CycleClock({ cycle, label = "ends" }: { cycle: TCycle; label?: string }) {
  const now = useNow();
  if (cycle.status !== "settling") return <span className="num">{label} <Countdown to={cycle.endsAt} /></span>;
  // Rotation runs ~30s after endsAt; the successor opens right after settlement.
  const next = cycle.endsAt + 60_000;
  return (
    <span className="num text-[#ffc457]" data-motion="settling">
      Settling… next cycle starts {now && next > now ? <>in <Countdown to={next} /></> : "any moment"}
    </span>
  );
}
