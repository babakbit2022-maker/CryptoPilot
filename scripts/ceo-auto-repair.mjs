import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Deterministic, allowlisted repairs only. This is deliberately NOT an unrestricted AI coder.
// Protected: public/, payment-wrapper.js, wallet/payment config, secrets, deployment config.
const allowlistedRepairScripts = ['scripts/harden-market-api.mjs'];
const protectedPrefixes = ['public/', '.env', '.github/workflows/', 'payment-wrapper.js'];
const protectedPatterns = [/TLSqNCn8Jdsh6eV4kty3sdeWhcpJFPeVS5/g, /USDT|TRC20|wallet|payment/gi];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function isProtected(path) {
  return protectedPrefixes.some((p) => path === p || path.startsWith(p));
}

function assertSafeDiff() {
  const names = git(['diff', '--name-only']).split('\n').filter(Boolean);
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const changed = [...new Set([...names, ...staged])];
  for (const path of changed) {
    if (isProtected(path)) throw new Error(`Protected path changed: ${path}`);
  }
  const diff = git(['diff', '--', ...changed]);
  for (const pattern of protectedPatterns) {
    if (pattern.test(diff)) throw new Error('Protected payment/wallet content detected in repair diff');
  }
}

for (const script of allowlistedRepairScripts) {
  if (!fs.existsSync(script)) throw new Error(`Allowlisted repair script missing: ${script}`);
}

console.log('CEO Engineer: running allowlisted deterministic repairs only.');
execFileSync(process.execPath, ['scripts/harden-market-api.mjs'], { stdio: 'inherit' });
assertSafeDiff();
console.log('CEO Engineer: repair guard passed; no protected paths/content changed.');
