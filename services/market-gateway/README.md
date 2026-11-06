# Paperhands market gateway

A standalone, read-only Node service for GMGN market data and shared Helius streams. It does not hold wallet signing keys or execute real trades.

Deploy this directory to a private GitHub repository accessible to Render, then create a Node Web Service in GOFi:

- Build: `node --check server.mjs`
- Start: `node server.mjs`
- Node: 22.18 or newer
- Health check: `/healthz`
- Secrets: `GMGN_API_KEY`, `SOLANA_WS_URL`, `MARKET_GATEWAY_TOKEN` (random 32+ bytes)
- Optional `GMGN_NOT_BEFORE`: Unix milliseconds; respect any outstanding provider cooldown before starting requests.

Set `MARKET_GATEWAY_URL` to the HTTPS service URL and the same `MARKET_GATEWAY_TOKEN` in the Paperhands Site runtime, then redeploy its saved version. Keys stay on the server. The browser uses the existing same-origin API.

The service deduplicates requests, caches real observations, queues one GMGN request at a time, waits 1.25 seconds after each response (including weight-5 holder/trader requests), and honors upstream reset timestamps. Real observation timestamps survive stale fallback. Only explicitly allowed market endpoints are accessible; transaction execution routes are rejected.

Live subscriptions are shared per pool (up to 10 simultaneously active pools) and close when the last viewer leaves. Confirmed Pump.fun/PumpSwap SOL-quoted events only. Other DEXs need additional verified decoders. No continuous all-chain scan.

A free service may sleep and has limited capacity. Use an always-on compute plan for public launch after measuring demand. A dedicated service is not a guarantee of a dedicated outbound IP; confirm GMGN accepts the provider's outbound address range. Do not rotate addresses to evade cooldowns.

Tests: `npm test` (no external requests, no dependencies).
