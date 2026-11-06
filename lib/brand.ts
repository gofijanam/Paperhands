// Brand asset paths: a pure file drop. Juno replaces the files in /public/brand/ (same names); no code changes needed.
export const BRAND = {
  mark: "/brand/logo-mark-64.png",     // header mark (64px PNG; 128 for @2x). The SVGs embed raster art (~0.5–1MB): never render them small.
  mark2x: "/brand/logo-mark-128.png",
  gateHero: "/brand/gate-hero.png",     // served via next/image (resized webp/avif)
  wordmark: "/brand/logo-wordmark.svg", // optional; the text wordmark is used until it exists (BRAND_HAS_WORDMARK)
  favicon: "/brand/favicon.ico",
  icon: "/brand/icon.png",
  appleIcon: "/brand/apple-icon.png",
  og: "/brand/og.png",
} as const;
/** Flip to true once Juno ships /public/brand/logo-wordmark.svg. */
export const BRAND_HAS_WORDMARK = false;
