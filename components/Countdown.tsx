"use client";
import { clock } from "@/lib/format";
import { useNow } from "@/lib/live";
export function Countdown({ to }: { to: number }) {
  const now = useNow();
  return <span className="num" data-motion="countdown" suppressHydrationWarning>{now ? clock((to - now) / 1000) : "--:--:--"}</span>;
}
