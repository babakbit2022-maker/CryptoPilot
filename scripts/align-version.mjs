import fs from 'node:fs';

const path = 'server.js';
const source = fs.readFileSync(path, 'utf8');
const updated = source
  .replace('CryptoPilot AI 2.2 source release.', 'CryptoPilot AI 2.3.1 source release.')
  .replace("version:'2.2.0'", "version:'2.3.1'");

if (updated === source) {
  console.log('No version mismatch found.');
  process.exit(0);
}
fs.writeFileSync(path, updated);
console.log('Aligned server.js version markers to 2.3.1.');
