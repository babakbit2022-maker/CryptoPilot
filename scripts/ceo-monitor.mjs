import process from 'node:process';

const base = (process.env.CRYPTOPILOT_URL || 'https://waterspout-pretty-rhinoceros.abasthan.app').replace(/\/$/, '');
const endpoints = ['/', '/crypto-chart.html?symbol=BTCUSDT&tf=1h', '/auth.html', '/api/health', '/api/ready', '/api/market-status', '/api/market/BTCUSDT?tf=15m', '/api/coins?q=BTC', '/robots.txt', '/sitemap.xml'];
const failures = [];
const results = [];

async function check(path) {
  const started = Date.now();
  try {
    const r = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'CryptoPilot-CEO-Agent/1.0' } });
    const body = await r.text();
    const ms = Date.now() - started;
    const ok = r.status >= 200 && r.status < 400;
    results.push({ path, status: r.status, ms, ok });
    if (!ok) failures.push(`${path}: HTTP ${r.status}`);
    if (path === '/api/health' && !body.includes('"ok":true')) failures.push(`${path}: health payload is not healthy`);
    if (path === '/api/ready' && !body.includes('"ready":true')) failures.push(`${path}: readiness payload is not ready`);
    if (path === '/api/market-status' && !body.includes('"online":true')) failures.push(`${path}: market providers appear offline`);
    if (path === '/api/market/BTCUSDT?tf=15m' && !body.includes('"candles"')) failures.push(`${path}: live chart payload missing candles`);
    if (path === '/' && body.includes("getElementById('coins')")) failures.push(`${path}: dashboard still references removed #coins element`);
    if (path === '/' && !body.includes('id="marketList"')) failures.push(`${path}: market list container missing`);
    if (path === '/crypto-chart.html?symbol=BTCUSDT&tf=1h' && !body.includes('id="chart"')) failures.push(`${path}: chart canvas missing`);
    if (path === '/auth.html' && !body.includes('/api/auth/')) failures.push(`${path}: auth client route missing`);
    if (path === '/robots.txt' && !body.includes('Sitemap:')) failures.push(`${path}: sitemap directive missing`);
    if (path === '/sitemap.xml' && !body.includes('<urlset')) failures.push(`${path}: invalid sitemap response`);
  } catch (e) {
    failures.push(`${path}: ${e?.message || e}`);
    results.push({ path, status: null, ms: Date.now() - started, ok: false });
  }
}

for (const path of endpoints) await check(path);

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), base, failures, results }, null, 2));

if (failures.length) process.exit(1);
