"use client";
import { useEffect, useRef, useState } from "react";
/** Re-triggers the price flash on every change of `value` (one node, restarted: never stacked). */
export function Flash({ value, children, className = "" }: { value: number; children: React.ReactNode; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (value !== prev.current) { setDir(value > prev.current ? "up" : "down"); setK((x) => x + 1); prev.current = value; }
  }, [value]);
  return <span key={k} data-motion="tick" data-flash={dir ?? undefined} className={`rounded-[3px] ${className}`}>{children}</span>;
}
