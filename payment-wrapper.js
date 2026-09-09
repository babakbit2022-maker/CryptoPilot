import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

const nativeFetch = globalThis.fetch;
const binanceHosts = ['api.binance.com','api1.binance.com','api2.binance.com','api3.binance.com','api4.binance.com'];
const krakenPairs = {BTC:'XBTUSD',ETH:'ETHUSD',SOL:'SOLUSD',BNB:'BNBUSD',XRP:'XRPUSD',DOGE:'DOGEUSD',ADA:'ADAUSD',AVAX:'AVAXUSD',LINK:'LINKUSD',DOT:'DOTUSD',LTC:'LTCUSD',TRX:'TRXUSD'};
const coingeckoIds = {bitcoin:'BTC',ethereum:'ETH',solana:'SOL',binancecoin:'BNB',ripple:'XRP',dogecoin:'DOGE',cardano:'ADA','avalanche-2':'AVAX',chainlink:'LINK',polkadot:'DOT',litecoin:'LTC',tron:'TRX'};

async function krakenSnapshot(symbol) {
  const pair = krakenPairs[symbol];
  if (!pair) throw new Error('No Kraken pair');
  const r = await nativeFetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, {headers:{accept:'application/json'}, signal:AbortSignal.timeout(9000)});
  if (!r.ok) throw new Error(`Kraken HTTP ${r.status}`);
  const j = await r.json();
  if (j.error?.length || !j.result) throw new Error('Kraken unavailable');
  const row = Object.values(j.result)[0];
  const price = Number(row?.c?.[0]);
  const volume24h = Number(row?.v?.[1]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Kraken bad price');
  return {price, volume24h:Number.isFinite(volume24h)?volume24h:null};
}

globalThis.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input?.url || '';
  if (raw.includes('api.binance.com')) {
    const u = new URL(raw); let last;
    for (const host of binanceHosts) { try { u.host = host; const r = await nativeFetch(u, {...init, signal:AbortSignal.timeout(2500)}); if (r.ok) return r; last = new Error(`Binance HTTP ${r.status}`); } catch (e) { last = e; } }
    throw last || new Error('Binance unavailable');
  }
  if (raw.includes('api.coingecko.com/api/v3/simple/price')) {
    try { const r = await nativeFetch(input, {...init, signal:AbortSignal.timeout(5000)}); if (r.ok) return r; throw new Error(`CoinGecko HTTP ${r.status}`); }
    catch { const u = new URL(raw); const id = u.searchParams.get('ids'); const symbol = coingeckoIds[id]; const s = await krakenSnapshot(symbol); const body = {[id]: {usd:s.price, usd_24h_change:null, usd_24h_vol:s.volume24h}}; return new Response(JSON.stringify(body), {status:200, headers:{'content-type':'application/json'}}); }
  }
  return nativeFetch(input, init);
};

const originalListen = express.application.listen;
const db = new Database(process.env.DB_PATH || 'cryptopilot.db');
db.exec(`CREATE TABLE IF NOT EXISTS page_views(id INTEGER PRIMARY KEY AUTOINCREMENT,visitor_id TEXT NOT NULL,path TEXT NOT NULL,referrer TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS payment_orders(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,txid TEXT UNIQUE NOT NULL,event_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
function validTxid(txid) { return /^[a-fA-F0-9]{64}$/.test(txid); }
function getPaymentConfig() { const wallet=String(process.env.USDT_TRC20_WALLET||process.env.TRON_RECEIVE_ADDRESS||'').trim(); const amount=Number(process.env.PREMIUM_USDT_AMOUNT||3); const tronApiKey=String(process.env.TRONGRID_API_KEY||'').trim(); return {enabled:Boolean(wallet),network:'TRC20',asset:'USDT',wallet,amount:Number.isFinite(amount)&&amount>0?amount:3,verification:tronApiKey?'automatic_ready':'manual_pending_trongrid_key'}; }
function cookieValue(req,name){const h=String(req.headers.cookie||'');const m=h.match(new RegExp('(?:^|;\\s*)'+name.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}
function authUser(req){try{const secret=process.env.JWT_SECRET;if(!secret||secret.length<32)return null;const bearer=String(req.headers.authorization||'');const raw=bearer.startsWith('Bearer ')?bearer.slice(7):cookieValue(req,'cp_session');if(!raw)return null;const p=jwt.verify(raw,secret);return db.prepare('SELECT id,email,plan,role FROM users WHERE id=?').get(p.id)||null;}catch{return null;}}
function adminUser(req){const u=authUser(req);return u&&u.role==='admin'?u:null;}
function daysAgo(n){return new Date(Date.now()-n*86400000).toISOString().slice(0,10);}
function analytics(req,res){const d=Number(req.query.days||7);const days=Math.max(1,Math.min(30,Number.isFinite(d)?d:7));const from=daysAgo(days-1);const views=Number(db.prepare("SELECT COUNT(*) n FROM page_views WHERE created_at>=datetime(?,'start of day')").get(from)?.n||0);const unique=Number(db.prepare("SELECT COUNT(DISTINCT visitor_id) n FROM page_views WHERE created_at>=datetime(?,'start of day')").get(from)?.n||0);const signups=Number(db.prepare("SELECT COUNT(*) n FROM users WHERE created_at>=datetime(?,'start of day')").get(from)?.n||0);const orders=Number(db.prepare("SELECT COUNT(*) n FROM payment_orders WHERE created_at>=datetime(?,'start of day')").get(from)?.n||0);const confirmed=Number(db.prepare("SELECT COUNT(*) n FROM payment_orders WHERE status='confirmed' AND created_at>=datetime(?,'start of day')").get(from)?.n||0);const premium=Number(db.prepare("SELECT COUNT(*) n FROM users WHERE plan='premium'").get()?.n||0);const daily=db.prepare("SELECT substr(created_at,1,10) day,COUNT(*) views,COUNT(DISTINCT visitor_id) unique_visitors FROM page_views WHERE created_at>=datetime(?,'start of day') GROUP BY day ORDER BY day").all(from);const recentOrders=db.prepare("SELECT txid,status,created_at FROM payment_orders ORDER BY id DESC LIMIT 20").all().map(x=>({txid:x.txid.slice(0,10)+'…'+x.txid.slice(-6),status:x.status,createdAt:x.created_at}));res.json({ok:true,rangeDays:days,totals:{views,uniqueVisitors:unique,signups,paymentSubmissions:orders,confirmedPurchases:confirmed,premiumUsers:premium},daily,recentOrders});}
function extractJson(text){try{return JSON.parse(text)}catch{}const m=String(text||'').match(/\{[\s\S]*\}/);if(m){try{return JSON.parse(m[0])}catch{}}return null;}
async function visionAnalyze(image,timeframe){
  const endpoint=String(process.env.VISION_API_URL||'').trim();
  const key=String(process.env.VISION_API_KEY||'').trim();
  const model=String(process.env.VISION_MODEL||'gpt-4o-mini').trim();
  if(!endpoint||!key)return {mode:'not_configured',analysis:{trend:'—',confidence:'—',support:'—',resistance:'—',risk:'—',setup:'—',summary:'The chart was received successfully. AI vision is not configured on this server yet.'}};
  const payload={model,temperature:0.1,messages:[{role:'system',content:'You are CryptoPilot AI chart analyst. Analyze only visible information in the screenshot. Never invent hidden prices. Return JSON only with keys trend, confidence, support, resistance, risk, setup, summary. Risk must be Low, Medium, High or Unknown. This is educational market analysis, not financial advice.'},{role:'user',content:[{type:'text',text:`Analyze this crypto trading chart screenshot. Timeframe: ${timeframe}. Identify visible trend, support/resistance, momentum clues, risk and a possible setup. If a value is not visible, use Unknown.`},{type:'image_url',image_url:{url:image}}]}]};
  const r=await nativeFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  const text=await r.text(); if(!r.ok)throw new Error(`Vision provider HTTP ${r.status}`);
  const j=JSON.parse(text); const raw=j.choices?.[0]?.message?.content; const parsed=extractJson(typeof raw==='string'?raw:raw?.find?.(x=>x.text)?.text); if(!parsed)throw new Error('Vision provider returned invalid analysis');
  return {mode:'vision',analysis:parsed};
}
express.application.listen=function patchedListen(...args){const app=this;app.use((req,res,next)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');next();});app.use(express.json({limit:'8mb'}));app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/')&&!req.path.startsWith('/admin')&&!req.path.includes('.')&&req.path!=='/favicon.ico'){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();const ua=String(req.headers['user-agent']||'').slice(0,300);const visitorId=crypto.createHash('sha256').update(ip+'|'+ua).digest('hex').slice(0,32);db.prepare('INSERT INTO page_views(visitor_id,path,referrer) VALUES(?,?,?)').run(visitorId,req.path,String(req.headers.referer||'').slice(0,500));}next();});app.get('/api/admin/stats',(req,res)=>{if(!adminUser(req))return res.status(403).json({error:'admin_required'});analytics(req,res);});app.post('/api/admin/bootstrap',(req,res)=>{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});const admins=Number(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get()?.n||0);if(admins>0)return res.status(409).json({error:'admin_already_configured'});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);res.json({ok:true,role:'admin'});});app.post('/api/ai/chart-analyze',async(req,res)=>{try{const image=String(req.body?.image||'');const timeframe=String(req.body?.timeframe||'15m');if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return res.status(400).json({error:'invalid_image'});if(image.length>8*1024*1024)return res.status(413).json({error:'image_too_large'});const out=await visionAnalyze(image,timeframe);res.json({ok:true,...out});}catch(e){res.status(502).json({error:'vision_unavailable',message:e.message});}});app.get('/api/payment/config',(req,res)=>{const cfg=getPaymentConfig();if(!cfg.enabled)return res.status(503).json({enabled:false,network:'TRC20',asset:'USDT',error:'payment_not_configured'});res.json({ok:true,...cfg});});app.post('/api/payment/submit',(req,res,next)=>{try{const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});const txid=String(req.body?.txid||'').trim();if(!validTxid(txid))return res.status(400).json({error:'invalid_txid'});const eventId=crypto.createHash('sha256').update(`tron:${txid}`).digest('hex');db.prepare('INSERT OR IGNORE INTO payment_orders(user_id,txid,event_id,status) VALUES(?,?,?,?)').run(u.id,txid,eventId,'pending');res.status(202).json({ok:true,status:'pending',eventId,txid,network:'TRC20',asset:'USDT',message:'Transaction received for verification.'});}catch(e){next(e);}});app.get('/api/payment/status',(req,res)=>{const cfg=getPaymentConfig();res.json({ok:true,configured:cfg.enabled,network:cfg.network,asset:cfg.asset,amount:cfg.amount,verification:cfg.verification});});return originalListen.apply(app,args);};
await import('./server.js');
