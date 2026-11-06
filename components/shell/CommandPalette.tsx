"use client";
import { useEffect, useRef, useState } from "react";
import { getApi, type TCoin } from "@/lib/api";

import { pct, usd } from "@/lib/format";
import { CoinAvatar } from "../CoinAvatar";
import { ISearch } from "../icons";
import { NAV } from "./Sidebar";

type Item = { key: string; label: string; sub: string; href: string; coin?: TCoin };

export function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  
  const [q, setQ] = useState("");
  const [res, setRes] = useState<TCoin[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { let on=true;setError("");setRes([]);if(!q.trim())return;setLoading(true);const t=setTimeout(()=>getApi().search(q).then(r=>on&&setRes(r)).catch(e=>on&&setError(e.message)).finally(()=>on&&setLoading(false)),350);return()=>{on=false;clearTimeout(t);}; }, [q]);

  const items: Item[] = q.trim()
    ? res.map((c) => ({ key: c.mint, label: `$${c.symbol}`, sub: c.name, href: `/coin/${c.mint}`, coin: c }))
    : [
        ...NAV.map((n) => ({ key: n.href, label: n.label, sub: "Go to page", href: n.href })),
      ];
  const go = (it?: Item) => { if (!it) return; onClose(); window.location.assign(it.href); };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-3 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search coins" className="panel w-full max-w-[560px] overflow-hidden shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <ISearch className="size-4 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} aria-label="Search by name, ticker or mint address"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === "Enter") go(items[i]);
            }}
            placeholder="Name, ticker or mint address" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <kbd className="rounded border border-line-2 px-1.5 font-mono text-[11px] text-muted">esc</kbd>
        </div>
        <ul role="listbox" aria-label="Results" className="scroll-thin max-h-[50vh] overflow-y-auto p-1.5">
          {loading&&<li className="p-5 text-muted">Searching Solana markets…</li>}{error&&<li role="alert" className="p-5 text-down">{error}</li>}{!loading&&!error&&items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">No coin matches “{q}”. Paste a full mint address to look it up.</li>}
          {items.map((it, k) => (
            <li key={it.key} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => go(it)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${k === i ? "bg-panel-3" : ""}`}>
              {it.coin ? <CoinAvatar mint={it.coin.mint} size={28} /> : <span className="grid size-7 place-items-center rounded-md border border-line-2 font-mono text-[11px] text-muted">→</span>}
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{it.label}</span><span className="block truncate text-[12px] text-muted">{it.sub}</span></span>
              {it.coin && <span className="num text-right text-[12px]"><span className="block text-soft">{usd(it.coin.mcapUsd)}</span><span className={it.coin.change24hPct >= 0 ? "text-up" : "text-down"}>{pct(it.coin.change24hPct)}</span></span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3 py-2 text-[12px] text-muted">↑↓ to move · enter to open · search real Solana pools</p>
      </div>
    </div>
  );
}
