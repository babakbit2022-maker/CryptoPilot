# CryptoPilot AI — Project State

Last updated: 2026-09-10

## Current reference
- Version: 2.2.0
- GitHub: babakbit2022-maker/CryptoPilot
- Branch: main
- Hosting: Abasthan Free Web Service
- Abasthan project: `cryptopailet`
- Abasthan service: `cryptopilot`
- Service ID: `6aa1e9a65d01385d0f9518a7`
- Live URL: https://waterspout-pretty-rhinoceros.abasthan.app
- Deployment: LIVE and confirmed by user
- `/api/health`: confirmed working by user

## Current architecture
- Node.js + Express
- SQLite via better-sqlite3
- JWT + httpOnly cookie authentication
- bcryptjs password hashing
- Helmet + rate limiting
- Binance market-data primary provider with CoinGecko fallback
- Market analysis, scanner, auth, alerts, SEO routes
- Dockerfile included for native better-sqlite3 builds

## Important runtime endpoints
- `/api/health`
- `/api/ready`
- `/api/market-status`
- `/api/market/BTCUSDT?tf=15m`
- `/api/scanner?tf=15m`

## Deployment rule
Abasthan is connected to GitHub `main`. Future code changes should be committed to `main`; Abasthan should auto-deploy the latest commit. Do not make the user repeat the deployment configuration unless the hosting connection itself breaks.

## Known limitation
The free host is suitable for testing and launch validation. SQLite persistence may not be durable across infrastructure replacement/redeploys; move to persistent/managed storage before treating the service as production-grade.

## Next verification sequence
1. Verify `/api/market-status`.
2. Verify BTC 15m market endpoint returns live provider/data.
3. Verify scanner returns multiple coins.
4. Verify register/login/logout and `/api/me`.
5. Verify SEO routes, robots.txt, sitemap.xml and canonical URL.
6. Add/verify production secrets such as JWT_SECRET without exposing them in GitHub.

## Continuation instruction
When continuing this project, start from this file and the current `main` branch. Do not rebuild from an older ZIP or ask the user to repeat the hosting setup unless the repository or Abasthan connection has changed.