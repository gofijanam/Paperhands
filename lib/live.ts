"use client";
import { useEffect, useRef, useState } from "react";
import { getApi, type PaperApi, type TCoin, type TTrade, type Tick } from "./api";


/** Applies live ticks to a list of coins and returns per-mint flash direction for the price-flash micro-motion. */
export function useLiveCoins(initial: TCoin[], api: PaperApi = getApi()) {
  const [coins, setCoins] = useState(initial);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useEffect(() => setCoins(initial), [initial]);
  const mints = initial.map((c) => c.mint).join(",");
  const apply = (ticks: Tick[]) => {
    const by = new Map(ticks.map((t) => [t.mint, t]));
    const fl: Record<string, "up" | "down"> = {};
    setCoins((cs) => cs.map((c) => {
      const t = by.get(c.mint);
      if (!t || !Number.isFinite(t.priceUsd) || !(c.priceUsd > 0)) return c;
      const k = t.priceUsd / c.priceUsd;
      if(k!==1)fl[c.mint] = k > 1 ? "up" : "down";
      return { ...c, priceUsd: t.priceUsd, priceSol: t.priceSol ?? c.priceSol, mcapUsd: t.mcapUsd ?? c.mcapUsd, change24hPct: t.change24hPct ?? c.change24hPct, observedAt: t.observedAt ?? c.observedAt };
    }));
    setFlash(fl);
  };
  useEffect(() => api.subscribeTicks(apply, mints ? mints.split(",") : []), [api, mints]);  
  return { coins, flash };
}
export function useLiveCoin(initial: TCoin, api?: PaperApi) {
  const { coins, flash } = useLiveCoins(useRef([initial]).current, api);
  return { coin: coins[0], dir: flash[initial.mint] };
}
export function useTradeTape(mint?: string, seed: TTrade[] = [], max = 40, api: PaperApi = getApi()) {
  const [list, setList] = useState<TTrade[]>(seed);
  useEffect(() => setList(seed), [seed]);
  useEffect(() => api.subscribeTrades((t) => setList((l) => (l.some((x) => x.id === t.id) ? l : [t, ...l].slice(0, max))), mint), [api, mint, max]);
  return list;
}
export function useNow(ms = 1000) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { setN(Date.now()); const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}
export function useAsync<T>(f: () => Promise<T>, deps: unknown[]) {
  const [v, setV] = useState<T | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { let on = true; f().then((x) => on && setV(x)).catch(() => {}); return () => { on = false; }; }, deps);
  return v;
}
