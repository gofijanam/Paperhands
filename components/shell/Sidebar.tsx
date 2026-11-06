"use client";
import Link from "@/components/SiteLink";
import { usePathname } from "next/navigation";
import { Wordmark } from "../Wordmark";
import { IChart, ICollapse, IExpand, IGift, IHome, ILock, ITrophy, IWallet } from "../icons";
import { usePaper } from "@/lib/store";
import { GATE_REQUIRED, TICKER } from "@/lib/constants";
import { num } from "@/lib/format";


export const NAV = [
  { href: "/", label: "Markets", Icon: IHome },
  { href: "/leaderboard", label: "Leaderboard", Icon: ITrophy },
  { href: "/portfolio", label: "Portfolio", Icon: IWallet },
  { href: "/rewards", label: "Rewards", Icon: IGift },
  { href: "/gate", label: "Access", Icon: ILock },
] as const;

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const path = usePathname();
  const p = usePaper();

  return (
    <aside data-motion="sidebar" className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-bg/80 backdrop-blur md:flex ${collapsed ? "w-[68px]" : "w-[216px]"} transition-[width] duration-300 ease-[var(--ease-house)]`}>
      <div className={`flex h-14 items-center ${collapsed ? "justify-center" : "justify-between px-4"}`}>
        <Link href="/" aria-label="paperhands home"><Wordmark compact={collapsed} /></Link>
        {!collapsed && <button onClick={onToggle} className="grid size-7 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-text" aria-label="Collapse sidebar"><ICollapse className="size-4" /></button>}
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2.5 pt-2">
        {NAV.map(({ href, label, Icon }) => {
          const on = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
              className={`group flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors ${collapsed ? "justify-center px-0" : ""} ${on ? "bg-panel-3 text-text" : "text-soft hover:bg-panel-2 hover:text-text"}`}>
              <Icon className={`size-[18px] ${on ? "text-accent" : "text-muted group-hover:text-text"}`} />
              {!collapsed && label}
            </Link>
          );
        })}
        <Link href="/" className={`btn btn-accent mt-3 h-10 text-[14px] ${collapsed ? "px-0" : ""}`} aria-label="Paper trade">
          {collapsed ? <IChart className="size-[18px]" /> : "Paper trade"}
        </Link>
      </nav>
      <div className="mt-auto p-2.5">
        {collapsed ? (
          <button onClick={onToggle} className="mx-auto grid size-9 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-text" aria-label="Expand sidebar"><IExpand className="size-4" /></button>
        ) : (
          <Link href="/gate" className="panel block p-3 transition-colors hover:border-line-2">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${p.passes ? "bg-up pulse-dot" : "bg-muted"}`} aria-hidden="true" />
              <span className="num text-[13px] text-text">{p.wallet ? num(p.paperHeld) : "—"} {TICKER}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">{!p.wallet ? "Connect to check access" : p.passes ? (p.practice ? "Practice account" : "Access granted") : `Need ${num(GATE_REQUIRED)} to trade`}</p>
          </Link>
        )}
      </div>
    </aside>
  );
}
