"use client";
import Link from "@/components/SiteLink";
import { usePathname } from "next/navigation";
import { NAV } from "./Sidebar";

export function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main mobile" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV.map(({ href, label, Icon }) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] ${on ? "text-accent" : "text-muted"}`}>
            <Icon className="size-5" />{label}
          </Link>
        );
      })}
    </nav>
  );
}
