import fs from 'node:fs';
import process from 'node:process';

const failures = [];
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const file of ['server.js', 'bootstrap.js', 'payment-wrapper.js']) {
  if (!fs.existsSync(new URL(`../${file}`, import.meta.url))) failures.push(`missing source file: ${file}`);
}

if (!packageJson.scripts?.start) failures.push('package.json: start script missing');
if (!packageJson.scripts?.check) failures.push('package.json: check script missing');

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
for (const route of ['/api/health', '/api/ready', '/api/market-status', '/api/coins', '/api/scanner', '/robots.txt', '/sitemap.xml']) {
  if (!server.includes(route)) failures.push(`server.js: expected route missing: ${route}`);
}

if (!server.includes('coingecko_snapshot')) failures.push('server.js: market-data fallback missing');
if (!server.includes('api.binance.com')) failures.push('server.js: Binance market provider missing');
if (server.includes('res.cookie(') || server.includes('res.clearCookie(')) failures.push('server.js: auth still depends on unavailable Express cookie helpers');
for (const file of ['public/index.html','public/crypto-chart.html','public/auth.html']) {
  if (!fs.existsSync(new URL(`../${file}`, import.meta.url))) failures.push(`missing public file: ${file}`);
}
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
if (index.includes("getElementById('coins')")) failures.push('public/index.html: stale #coins reference can abort dashboard loading');
if (!index.includes('id="marketList"')) failures.push('public/index.html: market list container missing');


const result = { checkedAt: new Date().toISOString(), version: packageJson.version, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
