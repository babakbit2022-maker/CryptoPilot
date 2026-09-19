const base = process.env.BASE_URL || 'http://87.107.190.74';
const pages = ['/', '/auth.html', '/account.html', '/payment.html', '/chart-analysis.html', '/crypto-chart.html', '/market-analysis', '/ai-crypto-chart-analysis', '/disclaimer.html', '/privacy.html', '/admin.html'];
const mustContain = {'/':['growthViewport','marketStats'],'/chart-analysis.html':['AI chart workspace','Analyze chart'],'/crypto-chart.html':['Live market intelligence','data-tf="15m"'],'/payment.html':['USDT TRC20','Verify & activate Premium'],'/market-analysis':['Crypto Market Analysis'],'/ai-crypto-chart-analysis':['AI Crypto Chart Analysis']};
async function get(path,options={}){const r=await fetch(base+path,{redirect:'manual',...options});return{status:r.status,text:await r.text()};}
for(const p of pages){const r=await get(p);if(r.status!==200)throw new Error(`PAGE ${p} HTTP ${r.status}`);for(const n of(mustContain[p]||[]))if(!r.text.includes(n))throw new Error(`PAGE ${p} missing ${n}`);}
async function json(path,allowed=[200]){const r=await get(path);if(!allowed.includes(r.status))throw new Error(`API ${path} HTTP ${r.status}: ${r.text.slice(0,300)}`);try{return{status:r.status,data:JSON.parse(r.text)}}catch{throw new Error(`API ${path} non-JSON`);}}
const h=await json('/api/health');if(!h.data.ok)throw new Error('health not ok');
const ready=await json('/api/ready');if(!ready.data.ready)throw new Error('ready not ok');
const coins=await json('/api/coins');if(!Array.isArray(coins.data.coins)||coins.data.coins.length<450||coins.data.totalUniverse!==500)throw new Error(`top-500 failed count=${coins.data.coins?.length}`);
for(const pair of ['BTCUSDT','ETHUSDT','SOLUSDT'])for(const tf of ['15m','1h','4h','1d']){const r=await json(`/api/market/${pair}?tf=${tf}&limit=100`);if(!Array.isArray(r.data.candles)||r.data.candles.length<20||!r.data.analysis||!Number.isFinite(Number(r.data.analysis.price)))throw new Error(`chart failed ${pair} ${tf}`);}
for(const p of ['/api/market-status','/api/top-gainers','/api/market-stats','/api/payment/status','/api/payment/verification-engine'])await json(p);
const s=await json('/api/scanner?tf=15m');if(!Array.isArray(s.data.results))throw new Error('scanner missing');
await json('/api/me',[401]);
const pay=await json('/api/payment/config',[200,503]);if(pay.status===200&&(!pay.data.wallet||pay.data.network!=='TRC20'||pay.data.asset!=='USDT'))throw new Error('payment config invalid');
console.log('PRODUCTION SMOKE TEST PASSED');
