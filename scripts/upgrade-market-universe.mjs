import fs from 'node:fs';

const serverPath = 'server.js';
let s = fs.readFileSync(serverPath, 'utf8');

// Idempotent guard: current dynamic market-universe implementations need no rewrite.
if (s.includes('async function refreshMarketUniverse()') && s.includes("const all=await refreshMarketUniverse()")) {
  console.log('Market universe already upgraded; nothing to do.');
  process.exit(0);
}

if (!s.includes("const symbols={BTCUSDT:'BTC'")) {
  console.log('Market universe source differs; refusing an unsafe automatic rewrite.');
  process.exit(0);
}

const oldSymbol = /const symbols=\{[^;]+\};\nconst tfMap=/;
const replacement = `const symbols={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA',AVAXUSDT:'AVAX',LINKUSDT:'LINK',DOTUSDT:'DOT',LTCUSDT:'LTC',TRXUSDT:'TRX'};\nconst symbolMeta=new Map(Object.entries(symbols).map(([pair,symbol])=>[pair,{symbol,coingeckoId:null}]));\nconst tfMap=`;
if (!oldSymbol.test(s)) throw new Error('symbol map shape not recognized');
s = s.replace(oldSymbol, replacement);

const marker = `async function binanceKlines(symbol,interval,limit=250){`;
const add = `async function refreshMarketUniverse(){\n  const now=Date.now();\n  const cached=cache.get('__universe');\n  if(cached&&now-cached.t<5*60*1000)return cached.v;\n  try{\n    const urls=['https://api.binance.com/api/v3/ticker/24hr','https://api1.binance.com/api/v3/ticker/24hr','https://api2.binance.com/api/v3/ticker/24hr'];\n    let data=null;\n    for(const u of urls){try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});if(r.ok){data=await r.json();break;}}catch{}}\n    if(!Array.isArray(data))throw new Error('binance universe');\n    const top=data.filter(x=>String(x.symbol).endsWith('USDT')&&!String(x.symbol).includes('UPUSDT')&&!String(x.symbol).includes('DOWNUSDT')&&!String(x.symbol).includes('BULL')&&!String(x.symbol).includes('BEAR')).sort((a,b)=>Number(b.quoteVolume||0)-Number(a.quoteVolume||0)).slice(0,120);\n    for(const x of top){const pair=String(x.symbol).toUpperCase(),symbol=pair.slice(0,-4);symbols[pair]=symbol;if(!symbolMeta.has(pair))symbolMeta.set(pair,{symbol,coingeckoId:null});}\n    const v=Object.entries(symbols).map(([pair,symbol])=>({pair,symbol,name:symbol}));cache.set('__universe',{t:now,v});return v;\n  }catch{\n    return Object.entries(symbols).map(([pair,symbol])=>({pair,symbol,name:symbol}));\n  }\n}\n\n`;
if (!s.includes(marker)) throw new Error('klines marker missing');
s = s.replace(marker, add + marker);

const oldCoins = `app.get('/api/coins',async(req,res)=>{const q=String(req.query.q||'').toLowerCase().trim();const list=Object.entries(symbols).map(([pair,symbol])=>({pair,symbol,name:symbol})).filter(x=>!q||x.symbol.toLowerCase().includes(q)||x.name.toLowerCase().includes(q));res.json({updatedAt:new Date().toISOString(),coins:list});});`;
const newCoins = `app.get('/api/coins',async(req,res)=>{const q=String(req.query.q||'').toLowerCase().trim();const all=await refreshMarketUniverse();const list=all.filter(x=>!q||x.symbol.toLowerCase().includes(q)||x.name.toLowerCase().includes(q));res.json({updatedAt:new Date().toISOString(),coins:list,count:list.length});});`;
if (!s.includes(oldCoins)) throw new Error('coins route shape not recognized');
s = s.replace(oldCoins, newCoins);

const oldMarket = `app.get('/api/market/:symbol',async(req,res)=>{const symbol=String(req.params.symbol||'').toUpperCase(),tf=String(req.query.tf||'15m');if(!symbols[symbol]||!tfMap[tf])return res.status(400).json({error:'unsupported_market'});try{res.json(await getAnalysis(symbol,tf));}catch{res.status(503).json({error:'market_unavailable'});}});`;
const newMarket = `app.get('/api/market/:symbol',async(req,res)=>{const symbol=String(req.params.symbol||'').toUpperCase(),tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});try{res.json(await getAnalysis(symbol,tf));}catch{res.status(503).json({error:'market_unavailable'});}});`;
if (!s.includes(oldMarket)) throw new Error('market route shape not recognized');
s = s.replace(oldMarket, newMarket);

const oldScanner = `app.get('/api/scanner',async(req,res)=>{const tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});const results=[];await Promise.all(Object.keys(symbols).map(async pair=>{try{const j=await getAnalysis(pair,tf),a=j.analysis;results.push({symbol:j.symbol,pair,price:a.price,bullScore:a.bullScore,bearScore:a.bearScore,riskScore:a.riskScore,setup:a.setup,rsi:a.rsi,momentum:a.momentum,volumeRatio:a.volumeRatio,provider:j.provider});}catch{}}));results.sort((a,b)=>Math.max(b.bullScore,b.bearScore)-Math.max(a.bullScore,a.bearScore));res.json({tf,updatedAt:new Date().toISOString(),results});});`;
const newScanner = `app.get('/api/scanner',async(req,res)=>{const tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();const results=[];await Promise.all(Object.keys(symbols).slice(0,100).map(async pair=>{try{const j=await getAnalysis(pair,tf),a=j.analysis;results.push({symbol:j.symbol,pair,price:a.price,bullScore:a.bullScore,bearScore:a.bearScore,riskScore:a.riskScore,setup:a.setup,rsi:a.rsi,momentum:a.momentum,volumeRatio:a.volumeRatio,provider:j.provider});}catch{}}));results.sort((a,b)=>Math.max(b.bullScore,b.bearScore)-Math.max(b.bearScore,a.bearScore));res.json({tf,updatedAt:new Date().toISOString(),results,count:results.length});});`;
if (!s.includes(oldScanner)) throw new Error('scanner route shape not recognized');
s = s.replace(oldScanner, newScanner);

s = s.replace("version:'2.2.0'", "version:'2.3.1'");
s = s.replace('CryptoPilot AI 2.2 listening on', 'CryptoPilot AI 2.3.1 listening on');
fs.writeFileSync(serverPath, s);

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = '2.3.1';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('Upgraded CryptoPilot market universe to dynamic top-USDT coverage (up to 120; scanner top 100).');
