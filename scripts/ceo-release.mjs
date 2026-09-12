import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 3100;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(port),
  JWT_SECRET: 'ceo-agent-local-test-secret-01234567890123456789',
  DB_PATH: '/tmp/cryptopilot-ceo.db',
  PUBLIC_BASE_URL: base,
};

const required = ['server.js', 'bootstrap.js', 'payment-wrapper.js', 'package.json'];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const child = spawn(process.execPath, ['bootstrap.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', b => { output += b.toString(); });
child.stderr.on('data', b => { output += b.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastError = null;

try {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch (e) { lastError = e; }
    await sleep(500);
  }

  const paths = ['/api/health', '/api/ready', '/api/market-status', '/api/coins?q=BTC', '/robots.txt', '/sitemap.xml'];
  const results = [];
  for (const path of paths) {
    const started = Date.now();
    try {
      const res = await fetch(`${base}${path}`);
      const text = await res.text();
      results.push({ path, status: res.status, ms: Date.now() - started, ok: res.ok, bytes: text.length });
      if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
      if (path === '/api/health' && !text.includes('"ok":true')) throw new Error('health payload is not healthy');
      if (path === '/api/ready' && !text.includes('"ready":true')) throw new Error('readiness payload is not ready');
      if (path === '/api/market-status' && !text.includes('"online":true')) throw new Error('market provider is not online');
      if (path === '/robots.txt' && !text.toLowerCase().includes('sitemap:')) throw new Error('robots.txt has no sitemap directive');
      if (path === '/sitemap.xml' && !text.includes('<urlset')) throw new Error('sitemap.xml is invalid');
    } catch (e) {
      lastError = e;
      results.push({ path, ok: false, error: String(e.message || e) });
      throw e;
    }
  }
  const report = { ok: true, timestamp: new Date().toISOString(), results };
  fs.writeFileSync('ceo-release.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill('SIGTERM');
  await sleep(250);
  if (!child.killed) child.kill('SIGKILL');
  if (lastError) console.error(`CEO release gate error: ${lastError.message || lastError}`);
  if (output && process.env.CEO_DEBUG) console.error(output.slice(-6000));
}
