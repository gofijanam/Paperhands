"use client";
import { useEffect, useState } from "react";
import type { PaperApi } from "@/lib/api";
import { price } from "@/lib/format";

/** 24h low/high range with a marker at the live price (from 1h candles; the live price widens the range if it breaks out). */
export function RangeBar({ api, mint, live }: { api: PaperApi; mint: string; live: number }) {
  const [hl, setHl] = useState<[number, number] | null>(null);
  useEffect(() => {
    let on = true;
    api.candles(mint, "1h").then((cs) => { const d = cs.slice(-24); if (on && d.length) setHl([Math.min(...d.map((c) => c.low)), Math.max(...d.map((c) => c.high))]); }).catch(() => {});
    return () => { on = false; };
  }, [api, mint]);
  if (!hl) return <div className="h-[38px] w-[180px]" aria-hidden="true" />;
  const lo = Math.min(hl[0], live), hi = Math.max(hl[1], live);
  const at = hi > lo ? ((live - lo) / (hi - lo)) * 100 : 50;
  return (
    <div className="w-[180px]" data-motion="range-bar">
      <div className="flex justify-between text-[11px] text-muted"><span>24h low</span><span>24h high</span></div>
      <div className="relative mt-1 h-1.5 rounded-full bg-gradient-to-r from-down/50 via-panel-3 to-up/50" role="meter" aria-label="Price within 24h range" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at)} aria-valuetext={`${Math.round(at)}% of the 24h range`}>
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-text shadow-[0_0_0_3px_rgba(198,255,61,.25)] transition-[left] duration-500 motion-reduce:transition-none" style={{ left: `${at}%` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-soft"><span>{price(lo)}</span><span>{price(hi)}</span></div>
    </div>
  );
}
