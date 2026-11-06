"use client";
import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";

export function EquityChart({ points, base }: { points: { t: number; v: number }[]; base: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#a1a1aa", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.04)" } },
      rightPriceScale: { borderColor: "#1f1f24" }, timeScale: { borderColor: "#1f1f24", timeVisible: true },
      handleScroll: false, handleScale: false,
    });
    const last = points.length ? points[points.length - 1].v : base;
    const rgb = last > base ? "34,197,94" : last < base ? "239,68,68" : "161,161,170"; // PnL sign vs start, not brand lime
    const s = c.addSeries(AreaSeries, {
      lineColor: `rgb(${rgb})`, topColor: `rgba(${rgb},.12)`, bottomColor: `rgba(${rgb},0)`, lineWidth: 2,
      priceFormat: { type: "custom", formatter: (p: number) => `◎${p.toFixed(3)}` },
      // Minimum ±2% of start so tiny moves don't render as cliffs.
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = orig(); const pad = base * 0.02;
        const min = Math.min(r?.priceRange.minValue ?? base, base - pad), max = Math.max(r?.priceRange.maxValue ?? base, base + pad);
        return { priceRange: { minValue: min, maxValue: max } };
      },
    });
    s.createPriceLine({ price: base, color: "#2c2c33", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "start" });
    const seen = new Map<number, number>();
    points.forEach((p) => seen.set(Math.floor(p.t / 1000), p.v));
    s.setData([...seen].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [points, base]);
  return <div ref={box} className="absolute inset-0" />;
}
