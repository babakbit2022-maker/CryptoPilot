# CryptoPilot AI — Project State

Last updated: 2026-09-13

## Current reference
- Version: 2.3.x chart-fix build
- GitHub: babakbit2022-maker/CryptoPilot
- Branch: main
- Hosting: Abasthan Free Web Service
- Abasthan project: `cryptopailet`
- Abasthan service: `cryptopilot`
- Service ID: `6aa1e9a65d01385d0f9518a7`
- Live URL: https://waterspout-pretty-rhinoceros.abasthan.app
- Deployment: GitHub main is connected to Abasthan auto-deploy

## Current architecture
- Node.js + Express
- SQLite via better-sqlite3
- JWT + httpOnly cookie authentication
- bcryptjs password hashing
- Helmet + rate limiting
- Binance market-data primary provider with CoinGecko fallback
- Market analysis, scanner, auth, alerts, SEO routes
- Dockerfile included for native better-sqlite3 builds

## Chart fix completed 2026-09-13
- Added `public/crypto-chart.html` as a real live candle-chart workspace.
- Chart supports 15m, 1h, 4h and 1d timeframes.
- 1h and 1d charts call the existing server-side `/api/market/:symbol?tf=...` endpoint, which fetches Binance OHLCV candles and falls back to CoinGecko snapshot data only when Binance is unavailable.
- Chart auto-refreshes every 30 seconds and uses no browser-side Binance API/CORS dependency.
- Market overview cards and scanner rows now open the selected coin's live chart.
- Root cause found: the backend already supported `1h` and `1d`, but the main UI did not actually render/link a live candle chart for selected assets.

## Important runtime endpoints
- `/api/health`
- `/api/ready`
- `/api/market-status`
- `/api/market/BTCUSDT?tf=15m`
- `/api/market/BTCUSDT?tf=1h`
- `/api/market/BTCUSDT?tf=1d`
- `/api/scanner?tf=15m`

## Deployment rule
Abasthan is connected to GitHub `main`. Future code changes should be committed to `main`; Abasthan should auto-deploy the latest commit. Do not make the user repeat the deployment configuration unless the hosting connection itself breaks.

## Known limitation
The free host is suitable for testing and launch validation. SQLite persistence may not be durable across infrastructure replacement/redeploys; move to persistent/managed storage before treating the service as production-grade.

## Next verification sequence
1. Verify the deployed `/crypto-chart.html?symbol=BTCUSDT&tf=1h` page.
2. Verify BTC 1h candles render and refresh.
3. Verify BTC 1d candles render and refresh.
4. Verify selecting ETH/SOL/etc. opens the correct live chart.
5. Verify scanner rows also open the selected chart.
6. Continue testing auth, AI analysis, SEO and payment flows.

## Continuation instruction
When continuing this project, start from this file and the current `main` branch. Do not rebuild from an older ZIP or ask the user to repeat the hosting setup unless the repository or Abasthan connection has changed.
