import fs from 'node:fs';

const p = 'server.js';
const s = fs.readFileSync(p, 'utf8');

// Idempotent hardening: the current release may already contain the repair.
const hardenedMarker = "const configured=(process.env.MARKET_BASE_URL||'').replace(/\\/$/,'');";
if (s.includes(hardenedMarker)) {
  console.log('Market API already hardened; no changes required.');
  process.exit(0);
}

const old = "async function binanceKlines(symbol,interval,limit=250){const base=(process.env.MARKET_BASE_URL||'https://api.binance.com').replace(/\\/$/,'');const u=`${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('market');return r.json();}";
const newer = "async function binanceKlines(symbol,interval,limit=250){const configured=(process.env.MARKET_BASE_URL||'').replace(/\\/$/,'');const bases=[configured,'https://api.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com'].filter((v,i,a)=>v&&!a.slice(0,i).includes(v));let last=null;for(const base of bases){try{const u=`${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(r.ok){const data=await r.json();if(Array.isArray(data)&&data.length)return data;}last=new Error('market');}catch(e){last=e;}}throw last||new Error('market');}";

if (!s.includes(old)) {
  throw new Error('Unexpected Binance klines implementation; refusing an unsafe automatic rewrite.');
}

fs.writeFileSync(p, s.replace(old, newer));
console.log('Hardened Binance candle provider with multi-host failover.');
