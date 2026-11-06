"use client";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Ticker } from "./Ticker";
import { MobileNav } from "./MobileNav";
import dynamic from "next/dynamic";
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });

const KEY = "paperhands.sidebar";
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem(KEY) === "1"); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  // Warm the lazily-split palette chunk after load so Cmd-K opens instantly (keystrokes aren't lost).
  const [warm, setWarm] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWarm(true), 1200); return () => clearTimeout(t); }, []);
  const toggle = () => setCollapsed((c) => { localStorage.setItem(KEY, c ? "0" : "1"); return !c; });
  return (
    <div className="relative z-10 flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onSearch={() => setPalette(true)} />
        <Ticker />
        <main id="main" className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      </div>
      <MobileNav />
      {(palette || warm) && <CommandPalette open={palette} onClose={() => setPalette(false)} />}
    </div>
  );
}
