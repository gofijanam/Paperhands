"use client";
import {useState} from "react";
import { hash } from "@/lib/rng";
// Deterministic fallback only when a real token image is missing or cannot load.
export function CoinAvatar({ mint, size = 36, label, imageUrl }: { mint: string; size?: number; label?: string; imageUrl?:string|null }) {
  const [failedUrl,setFailedUrl]=useState<string|null>(null);
  if(imageUrl && failedUrl!==imageUrl) return <img src={imageUrl} alt={label||""} width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedUrl(imageUrl)} className="shrink-0 rounded-lg object-cover" style={{width:size,height:size}}/>;
  const h = hash(mint);
  const hue = h % 360, hue2 = (hue + 40 + ((h >> 8) % 120)) % 360;
  const cells = Array.from({ length: 9 }, (_, i) => (h >> (i + 3)) & 1);
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0 rounded-lg">
      <rect width="36" height="36" rx="8" fill={`hsl(${hue} 28% 16%)`} />
      {cells.map((on, i) => on ? <rect key={i} x={6 + (i % 3) * 8} y={6 + Math.floor(i / 3) * 8} width="8" height="8" rx="2" fill={`hsl(${i % 2 ? hue : hue2} 55% ${50 + (i % 3) * 8}%)`} /> : null)}
      <rect x=".5" y=".5" width="35" height="35" rx="7.5" fill="none" stroke="rgba(255,255,255,.08)" />
    </svg>
  );
}
export function UserAvatar({ handle, size = 24 }: { handle: string; size?: number }) {
  const h = hash(handle); const hue = h % 360;
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold uppercase" style={{ width: size, height: size, background: `hsl(${hue} 30% 22%)`, color: `hsl(${hue} 70% 80%)` }}>
      {handle.replace(/[^a-z0-9]/gi, "").slice(0, 1)}
    </span>
  );
}
