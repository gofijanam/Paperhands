# Paperhands — implementation status

Updated 2026-11-06. Market observations are real; balances and execution are simulated.

## Implemented

- Server-only GMGN Agent API: discovery, search, coin metadata and holder counts, OHLCV, holder distribution, token top-trader PnL.
- D1 market cache, coalesced in-isolate requests, weighted cross-isolate rate scheduling and provider reset backoff. Stale data keeps its observation timestamp; execution rejects observations older than 30 seconds.
- Five-second discovery refresh while visible; no repeated per-token calls for every homepage row.
- Helius confirmed log subscription relayed over SSE on token pages for SOL-quoted Pump.fun and PumpSwap pools. Program-aware event parsing, failed-transaction exclusion, deduplication, reconnect, tab-visibility cleanup, five-minute renewal. Unsupported pools retain snapshot mode explicitly. Per-view sockets, not a global all-chain collector.
- Bounded recent confirmed transaction replay for supported Pump pools. No fabricated trade prints.
- Server-authoritative D1 paper ledger, atomic version-checked fills, quote expiry, idempotent retries. Fill response includes authoritative balance/positions immediately; other portfolio prices refresh independently. Older account versions cannot replace newer balances.
- Wallet sign-in, practice accounts, token gating support, leaderboard and daily close bookkeeping.

## Not activated / launch dependencies

- PAPER mint is not configured. Holder competition remains disabled; practice works without a token.
- No reward treasury, actual payout signer, receipt verification or unattended settlement executor is configured. No payouts are claimed or sent.
- Current free data keys and per-view streaming are for bounded preview traffic. Broad DEX coverage and a shared 24/7 collector require persistent streaming infrastructure and a measured provider capacity plan. No paid services were provisioned.
- A full-market sub-second update guarantee is not made. Instant stream is limited to supported pools; discovery is a separate REST snapshot path.

## Validation

- TypeScript build checks and paper-engine/format/market mapping tests.
- Public GMGN API verified with real token, holder, trader and OHLCV responses.
- Runtime deployment and browser checks recorded separately after publication.
- Production browser verified GATO confirmed Helius events arriving, real largest-token-account responses, and a virtual buy updating balance from 10.001 to 9.901 SOL. Sell verification exposed stale discovery-cache selection; fresh quotes now prefer the direct token endpoint and skip bulk snapshots older than ten seconds. The 30-second execution freshness guard remains enforced.

## Production blocker observed in this revision

GMGN returned HTTP 429 `RATE_LIMIT_BANNED` with the explicit message `IP is temporarily banned due to repeated rate limit violations` from the current hosted runtime. The key itself passed direct read-only API tests. This distinguishes a hosting/provider access failure from missing UI integration. Direct GMGN calls are paused (`GMGN_DIRECT_PAUSED=1`) to respect the provider block; existing public feeds remain available.

`services/market-gateway/` contains a tested standalone deployment package with a single request queue, cache, cooldown handling and per-pool shared Helius streams. The Site supports its `MARKET_GATEWAY_URL` / `MARKET_GATEWAY_TOKEN` connection. It is **not deployed**: the connected GitHub account exposes only the unrelated Quiver repository, repository creation is unavailable through the connector, and the browser requires GitHub sign-in. A private Paperhands repository with access for both GitHub and Render is required to continue without mixing projects.

Largest token accounts have a bounded Helius RPC fallback (explicitly labeled, not a claimed complete holder index). Top-trader ranking still requires the GMGN gateway. No new paid infrastructure was provisioned.

## Resume verification

Version 12 was recovered from its pushed source after the interrupted session; its production deployment remained successful. The connected GitHub account still exposes only Quiver.

Added client stream heartbeat timeout, reconnection status handling, stale-connection event rejection, and visibility/unsubscribe cleanup tests. A transient disconnect now displays reconnection rather than claiming the pool is unsupported. A fully sold position no longer shows a negative estimated return or keeps a prior sell quote visible. The previously observed GMGN cooldown has elapsed; the recovery check on the same hosting origin returned RATE_LIMIT_BANNED_MAX. Direct GMGN calls were paused again in environment revision 5. Provider limits and cooldown handling remain enforced.

## DEX Screener enrichment

Official reference reviewed: https://docs.dexscreener.com/api/reference. Public REST covers pool prices, liquidity, volume, buy/sell transaction counts, price changes, FDV, market cap, pool creation, links, boosts and paid promotion metadata. It does not document wallet trade histories, PnL top-trader rankings, complete holders, OHLCV candles or a WebSocket feed. Pair/token endpoints document 300 requests/minute, profile/boost/order endpoints 60, and bulk tokens accepts up to 30 addresses. No new key is required for the documented public endpoints.

Token page adds 5m/1h/6h/24h market activity and a Pools table, using shared ten-second server snapshots with original observation timestamps, explicit delayed state, unknown values preserved and pool-scoped statistics. Boosts are identified as paid promotion. Active wallets is a separate aggregation of the latest displayed real trades, not historical profit ranking. Full wallet addresses survive the public-trade mapping and link to Solscan. Existing theme and paper-order routing remain in place.


## Railway migration — 2026-11-06

- Complete source and brand assets copied to gofijanam/Paperhands.
- Native Node 24 / Next.js server; D1-compatible transactional SQLite adapter on a mounted /data volume. One replica only.
- One-time private import preserves the preview practice accounts, fills, cycles and hashed sessions. No live customer wallets existed at the migration snapshot.
- Token-page Top traders now reads only verified Paperhands wallet fills in the current UTC cycle, ranked by realized paper PnL for the selected token. Anonymous practice and external GMGN rankings excluded.
- Helius stream shared per mint across viewers, with reconnect, slot heartbeat and disconnect cleanup.
- RPC largest-token-accounts fallback resolves and groups owners; coverage remains the top 20 accounts, never claimed as the complete holder set.
- GMGN remains paused. PAPER mint, ranked competition and funded reward distribution still require launch configuration.
