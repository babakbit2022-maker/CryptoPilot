import process from 'node:process';

const base = (process.env.CRYPTOPILOT_URL || 'https://waterspout-pretty-rhinoceros.abasthan.app').replace(/\/$/, '');
const endpoints = ['/', '/api/health', '/api/ready', '/api/market-status', '/api/coins?q=BTC', '/robots.txt', '/sitemap.xml'];
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
