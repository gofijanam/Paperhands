# Paperhands backend

Solana paper-trading API for Paperhands ($PAPER). See `../api/CONTRACT.md`.

## Quick start (mock — Wren)

```bash
cd backend
npm install
npm run mock
# listens on http://127.0.0.1:8807
curl http://127.0.0.1:8807/v1/health
```

## Live mode

```bash
# HELIUS_* loaded automatically from ~/.secrets/helius.env (never printed)
cp .env.example .env.local   # fill non-secret defaults
npm run live
# listens on http://127.0.0.1:8807
```

## Read-only live smoke (keyless APIs)

```bash
npm run smoke:live
```

Never print or commit keys. HOST defaults to `127.0.0.1`. No mainnet fund moves.

## Tests

```bash
npm test
```
