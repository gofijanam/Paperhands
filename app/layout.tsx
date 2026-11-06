import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import localFont from "next/font/local";
import "./globals.css";
import { PaperProvider } from "@/lib/store";
import { AppShell } from "@/components/shell/AppShell";

const geist = localFont({ src: "./fonts/Geist.woff2", variable: "--font-geist", weight: "100 900", display: "swap", adjustFontFallback: "Arial" });
const geistMono = localFont({ src: "./fonts/GeistMono.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap", adjustFontFallback: "Arial" });

export const metadata: Metadata = {
  title: { default: "paperhands · real markets, paper trades", template: "%s · paperhands" },
  description: "Paper-trade supported Solana pairs at real market prices. Hold $PAPER to enter, climb the cycle leaderboard. Real market data. Virtual funds.",
  robots: { index: false, follow: false },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4331"),
  icons: { icon: [{ url: BRAND.favicon, sizes: "any" }, { url: BRAND.icon, type: "image/png", sizes: "512x512" }], apple: [{ url: BRAND.appleIcon, sizes: "180x180" }] },
  openGraph: { type: "website", siteName: "paperhands", title: "paperhands · real markets, paper trades", description: "Paper-trade supported Solana pairs at real market prices. Unranked preview, paper funds only.", images: [{ url: BRAND.og, width: 1200, height: 630, alt: "paperhands" }] },
  twitter: { card: "summary_large_image", title: "paperhands · real markets, paper trades", description: "Paper-trade supported Solana pairs at real market prices. Unranked preview, paper funds only.", images: [BRAND.og] },
};
export const viewport: Viewport = { themeColor: "#070708", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <div className="glow-top" aria-hidden="true" />
        <div className="grain-wrap" aria-hidden="true" />
        <PaperProvider><AppShell>{children}</AppShell></PaperProvider>
      </body>
    </html>
  );
}
