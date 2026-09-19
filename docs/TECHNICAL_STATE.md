# CryptoPilot AI — Technical State Log

## 2026-09-19 — Stability pass

### Baseline
- Production code baseline before this pass: commit `31dac95451afd6ca83899ad6b130d74f2aa9606c`.
- Application version: 2.7.0.
- Production monitor target used by CEO Engineer: `http://87.107.190.74`.
- Wallet/payment receive address is protected and is not to be changed by automated repairs.
- Visual design/branding/public payment UI are protected from automated technical repairs.

### Problems found and fixed
1. **Dashboard JavaScript crash**
   - `public/index.html` still called `document.getElementById('coins')` after the old `#coins` block had been replaced by `#marketList`.
   - Result: the main market-loading function could abort before rendering the live market list.
   - Fixed by removing the stale DOM reference.

2. **Authentication cookie failure**
   - `server.js` used `res.cookie()` and `res.clearCookie()`, but the project does not install Express cookie-parser/session helpers that provide those methods.
   - Registration/login could therefore fail after credential handling.
   - Fixed with self-contained HTTP `Set-Cookie` headers using HttpOnly, SameSite=Lax, Path=/, Max-Age and Secure in production.

3. **Chart controls**
   - The chart had a duplicate 1-minute button labelled `1M` and no actual horizontal pan implementation.
   - Fixed by removing the duplicate button and adding pointer-drag horizontal panning while preserving wheel zoom and reset.

4. **CEO technical monitoring**
   - Expanded static and production checks to cover dashboard/chart/auth assets and the live BTC market payload.
   - Added regression checks for the removed `#coins` reference and missing market list container.

### Verification
- The fixes were committed and merged to `main` as:
  `d43c007e76f3e80aaa77273093d45ac650e3be7a`
- The merge was verified by GitHub as successful.
- The pre-fix CEO Engineer run had passed infrastructure/API checks, but it did not exercise the browser DOM, which is why the dashboard crash escaped that monitor.
- A direct network test from this execution environment could not connect to port 80 on the VPS, so VPS post-deploy reachability is **not yet independently re-verified from here**.

### Next technical checks
1. Confirm the VPS has deployed commit `d43c007e...`.
2. Browser-level test: dashboard loads 500-market list without console errors.
3. Browser-level test: BTC/ETH chart loads, updates, zooms and pans.
4. Browser-level test: sign-up/login/logout session works.
5. Test Premium/payment flow without changing the protected receive address.
6. Test Daily AI Picks and AI Trade Vision.
7. Confirm public domain and VPS IP serve the same release.
8. Keep recording every technical change in this file.

## Rule for future automated repairs
Automated repairs may change deterministic technical/infrastructure code and tests, but must not change:
- USDT payment wallet/receive address
- payment secrets
- visual design/branding/layout unless Babak explicitly approves it
- public payment wording/address configuration

## 2026-09-19 — Restore requested dashboard layout

- User-requested visual structure restored on `main` without changing the payment wallet/address or protected payment configuration.
- New dashboard order: Highest Growth banner → full top-500 market universe → 15 assets per page pagination → CryptoPilot tools → existing risk/scanner/system intelligence.
- Market list is now paginated at exactly 15 assets per page with numbered pages, Prev/Next controls, rank numbers, live price, 24h change, Risk and Bull fields, and search-aware pagination.
- Added a dedicated `CryptoPilot Tools` area below the market list so users can choose AI Chart Analysis, Live Trading Chart, Market Scanner, or Premium/Account.
- Preserved the existing live `/api/coins`, `/api/top-gainers`, scanner, chart navigation, and Daily AI Picks data flows.
- Fixed the dashboard error fallback so it no longer targets the removed stale `#coins` element.
- Commit: `b470ec07d8b602938777a96c12ef1070fd925be3`.
- Verification still required after VPS deployment: browser-level check of 500-coin pagination, search, banner, tool links, and mobile layout.


## 2026-09-19 — Daily AI Picks premium lock + historical performance
- Daily AI Picks are now server-side premium gated: free users receive only locked placeholders; premium users receive the five actual picks and signal details.
- Added persistent SQLite tables `daily_pick_runs` and `daily_pick_items` so each calendar day's first generated five picks are recorded with entry prices.
- Added `/api/daily-picks/history` for authenticated premium users.
- Dashboard now shows **Yesterday's Daily Picks Performance** only when a real recorded prior-day run exists. The displayed figure is equal-weight price change from recorded entry prices and is explicitly labeled historical, not guaranteed return.
- No wallet/payment address/configuration was changed.
- Important: because the project did not previously persist Daily AI Picks history, the dashboard may initially show “No completed daily history yet”; once two daily runs have been recorded, yesterday's figure can be computed from actual stored entries and current market prices.
- Browser/VPS verification remains required after deployment; do not claim the live VPS is updated until verified.


## 2026-09-19 — Highest Growth Now live moving ticker
- Restored the requested moving-market behavior for Highest Growth Now: top live gainers are rendered as a horizontally scrolling ticker rather than a static row.
- Uses the existing live /api/top-gainers data, shows rank/symbol/price/24h change, duplicates the track for continuous looping, pauses on hover, and clicking a mover opens its market view.
- Preserved the existing dashboard visual structure and did not change wallet/payment configuration.
- VPS/browser verification remains required after deployment.
