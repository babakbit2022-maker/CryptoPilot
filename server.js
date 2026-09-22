import 'dotenv/config';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';

// CryptoPilot AI technical release. Full release archive is maintained in project Library.
const app = express();
const port = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) console.warn('WARNING: JWT_SECRET must be a random 32+ character secret in production.');
const db = new Database(process.env.DB_PATH || 'cryptopilot.db');
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');
try { db.exec("ALTER TABLE users ADD COLUMN premium_until TEXT"); } catch {} try { db.exec("ALTER TABLE users ADD COLUMN display_name TEXT"); } catch {}
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,plan TEXT NOT NULL DEFAULT 'free',role TEXT NOT NULL DEFAULT 'user',email_verified INTEGER NOT NULL DEFAULT 0,premium_until TEXT,display_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,symbol TEXT NOT NULL,target REAL NOT NULL,direction TEXT NOT NULL DEFAULT 'above',active INTEGER NOT NULL DEFAULT 1,triggered_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,event_id TEXT UNIQUE,provider TEXT,status TEXT,amount INTEGER,currency TEXT,authority TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,meta TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_predictions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,symbol TEXT NOT NULL,tf TEXT NOT NULL,bias TEXT NOT NULL,entry REAL,stop REAL,tp1 REAL,tp2 REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,status TEXT NOT NULL DEFAULT 'pending',outcome TEXT,source TEXT DEFAULT 'live',FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_market ON ai_predictions(symbol,tf,created_at);
CREATE TABLE IF NOT EXISTS daily_pick_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,run_date TEXT UNIQUE NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS daily_pick_items(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,symbol TEXT NOT NULL,rank INTEGER NOT NULL,entry_price REAL NOT NULL,score REAL,confidence TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(run_id) REFERENCES daily_pick_runs(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_daily_pick_items_run ON daily_pick_items(run_id,rank);
CREATE TABLE IF NOT EXISTS daily_pick_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,item_id INTEGER NOT NULL,symbol TEXT NOT NULL,price REAL NOT NULL,recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(run_id) REFERENCES daily_pick_runs(id) ON DELETE CASCADE,FOREIGN KEY(item_id) REFERENCES daily_pick_items(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_daily_pick_snapshots_lookup ON daily_pick_snapshots(run_id,symbol,recorded_at);
CREATE TABLE IF NOT EXISTS daily_pick_results(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,item_id INTEGER NOT NULL,symbol TEXT NOT NULL,target_at TEXT NOT NULL,entry_price REAL NOT NULL,exit_price REAL NOT NULL,change_pct REAL NOT NULL,source TEXT NOT NULL DEFAULT '24h_snapshot',evaluated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(run_id,item_id),FOREIGN KEY(run_id) REFERENCES daily_pick_runs(id) ON DELETE CASCADE,FOREIGN KEY(item_id) REFERENCES daily_pick_items(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_daily_pick_results_run ON daily_pick_results(run_id);
`);
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12mb' }));
app.use(async (req,res,next)=>{
  const p=req.path==='/'?'index.html':(req.path.endsWith('.html')?req.path.slice(1):'');
  if(p){
    try{
      const file=fs.readFileSync('public/'+p,'utf8');
      if(!file.includes('src="/i18n.js"')) return res.type('html').send(file.replace(/<\/body>/i,'<script src="/i18n.js"></script></body>'));
      return res.type('html').send(file);
    }catch{}
  }
  next();
});
app.use(express.static('public', { extensions: ['html'] }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimit = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const aiLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimit);
function sign(u) { return jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '2h' }); }
function sessionCookieOptions(maxAge, secure=false) {
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}
function setSession(res, u, req) {
  // Keep HTTP deployments usable while automatically enabling Secure cookies behind HTTPS.
  const secure = Boolean(req?.secure);
  res.setHeader('Set-Cookie', `cp_session=${encodeURIComponent(sign(u))}; ${sessionCookieOptions(2 * 60 * 60 * 1000, secure)}`);
}
function clearSession(res, req) {
  const secure = Boolean(req?.secure);
  res.setHeader('Set-Cookie', `cp_session=; ${sessionCookieOptions(0, secure)}`);
}
function readCookie(req, name) { const h = req.headers.cookie || ''; const m = h.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
function optionalAuth(req,res,next){try{const bearer=String(req.headers.authorization||'');const raw=bearer.startsWith('Bearer ')?bearer.slice(7):readCookie(req,'cp_session');if(!raw||!JWT_SECRET){req.user=null;return next();}const p=jwt.verify(raw,JWT_SECRET);req.user=db.prepare('SELECT id,email,plan,role,email_verified,premium_until,display_name FROM users WHERE id=?').get(p.id)||null;}catch{req.user=null;}next();}
function auth(req, res, next) { try { if (!JWT_SECRET) throw new Error(); const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''; const raw = bearer || readCookie(req, 'cp_session'); if (!raw) throw new Error(); req.user = jwt.verify(raw, JWT_SECRET); const u = db.prepare('SELECT id,email,plan,role,email_verified FROM users WHERE id=?').get(req.user.id); if (!u) throw new Error(); req.user = u; next(); } catch { res.status(401).json({ error: 'unauthorized' }); } }
function premium(req,res,next){if(req.user.plan!=='premium')return res.status(403).json({error:'premium_required'});if(req.user.premium_until&&new Date(req.user.premium_until).getTime()<=Date.now()){db.prepare("UPDATE users SET plan='free' WHERE id=?").run(req.user.id);return res.status(403).json({error:'premium_expired'});}next();}
async function sendAccountEmail(to,subject,html){const key=String(process.env.RESEND_API_KEY||'').trim();const from=String(process.env.RESEND_FROM||'CryptoPilot AI <onboarding@resend.dev>').trim();if(!key){console.warn('Email not configured; skipping account email');return false;}try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,html}),signal:AbortSignal.timeout(10000)});return r.ok;}catch{return false;}}
function accountState(u){const until=u.premium_until?new Date(u.premium_until):null;const daysRemaining=until?Math.max(0,Math.ceil((until.getTime()-Date.now())/86400000)):0;const active=u.plan==='premium'&&(!until||daysRemaining>0);return{plan:active?'premium':'free',premiumActive:active,premiumUntil:until?until.toISOString():null,daysRemaining};}
function audit(userId, action, meta={}) { db.prepare('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)').run(userId || null, action, JSON.stringify(meta)); }
function aiMemoryBias(a){if(!a)return 'NEUTRAL';if(a.setup==='BULLISH_SETUP')return 'LONG';if(a.setup==='BEARISH_SETUP')return 'SHORT';return Number(a.bullScore||0)>Number(a.bearScore||0)?'LONG':Number(a.bearScore||0)>Number(a.bullScore||0)?'SHORT':'NEUTRAL';}
function aiMemoryEvaluate(rows,currentPrice){for(const p of rows){if(p.status!=='pending')continue;const px=Number(currentPrice);const entry=Number(p.entry),stop=Number(p.stop),tp1=Number(p.tp1);if(!Number.isFinite(px)||!Number.isFinite(entry)||!Number.isFinite(stop)||!Number.isFinite(tp1))continue;let outcome=null;if(p.bias==='LONG'){if(px>=tp1)outcome='TP1_HIT';else if(px<=stop)outcome='STOP_HIT';}else if(p.bias==='SHORT'){if(px<=tp1)outcome='TP1_HIT';else if(px>=stop)outcome='STOP_HIT';}if(outcome){db.prepare("UPDATE ai_predictions SET status='resolved',outcome=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(outcome,p.id);}}}
function aiMemorySummary(symbol,tf){const rows=db.prepare("SELECT * FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);const resolved=rows.filter(x=>x.status==='resolved');const wins=resolved.filter(x=>x.outcome==='TP1_HIT').length;return {total:rows.length,resolved:resolved.length,wins,accuracy:resolved.length?Math.round(wins/resolved.length*100):null,pending:rows.length-resolved.length,last:rows[0]||null};}
app.post('/api/translate',aiLimit,async(req,res)=>{
  const language=String(req.body?.language||readCookie(req,'cp_language')||'en').toLowerCase();
  const target=language==='fa'?'Persian':language==='ru'?'Russian':'English';
  const texts=Array.isArray(req.body?.texts)?req.body.texts.map(x=>String(x||'').trim()).filter(Boolean).slice(0,90):[];
  if(!texts.length)return res.json({ok:true,translations:{}});
  if(target==='English')return res.json({ok:true,translations:Object.fromEntries(texts.map(x=>[x,x]))});
  try{
    if(!process.env.OPENAI_API_KEY)throw Error('translation_not_configured');
    const prompt='Translate each UI string into '+target+'. Preserve numbers, crypto symbols, punctuation and meaning. Return ONLY valid JSON object mapping each original string to its translation. Strings: '+JSON.stringify(texts);
    const rr=await fetch('https://1xai.ir/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',temperature:0,messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(25000)});
    if(!rr.ok)throw Error('translation_provider');
    const j=await rr.json();
    const raw=String(j.choices?.[0]?.message?.content||'').trim().replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
    const translations=JSON.parse(raw);
    if(!translations||typeof translations!=='object')throw Error('translation_json');
    res.json({ok:true,language,translations});
  }catch{res.status(503).json({ok:false,error:'translation_unavailable'});}
});
app.get('/api/health', (req,res)=>res.status(200).json({ok:true,service:'CryptoPilot AI',version:'2.7-technical',time:new Date().toISOString()}));
app.get('/api/ready', (req,res)=>res.status(200).json({ok:true,ready:true,version:'2.7.0'}));
app.post('/api/auth/register',authLimit,async(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password,name=String(req.body?.name||'').trim().replace(/[<>]/g,'').slice(0,80);if(!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<8)return res.status(400).json({error:'invalid_credentials'});try{const hash=await bcrypt.hash(password,12);const r=db.prepare('INSERT INTO users(email,password,display_name) VALUES(?,?,?)').run(email,hash,name||null);const u=db.prepare('SELECT id,email,plan,role,premium_until,display_name FROM users WHERE id=?').get(r.lastInsertRowid);setSession(res,u,req);audit(u.id,'register',{name});sendAccountEmail(email,'Welcome to CryptoPilot AI',`<div style="font-family:Arial,sans-serif"><h2>Welcome to CryptoPilot AI${name?', '+name:''} 👋</h2><p>Thank you for creating your account.</p><p>Your account is ready. You can sign in anytime to manage your profile and Premium access.</p><p>Your password is never sent by email.</p></div>`).catch(()=>{});res.json({user:{...u,name}});}catch{res.status(409).json({error:'email_exists'});}});
app.post('/api/auth/login',authLimit,async(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!(await bcrypt.compare(password,u.password)))return res.status(401).json({error:'invalid_login'});if(u.plan==='premium'&&u.premium_until&&new Date(u.premium_until).getTime()<=Date.now()){db.prepare("UPDATE users SET plan='free' WHERE id=?").run(u.id);u.plan='free';}setSession(res,u,req);audit(u.id,'login');res.json({user:{id:u.id,email:u.email,plan:u.plan,role:u.role,premium_until:u.premium_until||null,...accountState(u)}});});
app.post('/api/auth/logout',(req,res)=>{clearSession(res,req);res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>{if(req.user.plan==='premium'&&req.user.premium_until&&new Date(req.user.premium_until).getTime()<=Date.now()){db.prepare("UPDATE users SET plan='free' WHERE id=?").run(req.user.id);req.user.plan='free';}res.json({user:{...req.user,...accountState(req.user)}});});
app.get('/api/account',auth,(req,res)=>{const u=db.prepare('SELECT id,email,plan,role,email_verified,premium_until,display_name,created_at FROM users WHERE id=?').get(req.user.id);res.json({ok:true,user:{...u,...accountState(u)}});});
const symbols={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA',AVAXUSDT:'AVAX',LINKUSDT:'LINK',DOTUSDT:'DOT',LTCUSDT:'LTC',TRXUSDT:'TRX'};
const symbolMeta=new Map(Object.entries(symbols).map(([pair,symbol])=>[pair,{symbol,coingeckoId:null}]));
const tfMap={'1m':1,'15m':15,'1h':60,'4h':240,'1d':1440};
const cache=new Map();
const MARKET_CACHE_FILE=process.env.MARKET_CACHE_FILE || 'market-universe-cache.json';
try{
  const persisted=JSON.parse(fs.readFileSync(MARKET_CACHE_FILE,'utf8'));
  if(Array.isArray(persisted?.v)&&persisted.v.length>=100)cache.set('__universe',persisted);
}catch{}
function persistUniverse(v,t=Date.now()){
  try{fs.writeFileSync(MARKET_CACHE_FILE,JSON.stringify({t,v}),'utf8');}catch{}
}
let universeInflight=null;
async function refreshMarketUniverse(){
  const now=Date.now();
  const cached=cache.get('__universe');
  // Serve cached market data immediately on page load. If stale, refresh in the background
  // so the dashboard never waits on the external provider before rendering.
  if(cached){
    if(now-cached.t<60*1000)return cached.v;
    if(!universeInflight){ refreshMarketUniverseFresh().catch(()=>{}); }
    return cached.v;
  }
  return refreshMarketUniverseFresh();
}
async function refreshMarketUniverseFresh(){
  const now=Date.now();
  if(universeInflight)return universeInflight;
  universeInflight=(async()=>{try{
    // CoinMarketCap is the primary market-data source. Use its public keyless
    // endpoint so the app can run immediately; a CMC API key can later be
    // supplied through CMC_API_KEY without changing the frontend.
    const base=process.env.CMC_API_KEY
      ? 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest'
      : 'https://pro-api.coinmarketcap.com/public-api/v1/cryptocurrency/listings/latest';
    const headers={accept:'application/json'};
    if(process.env.CMC_API_KEY)headers['X-CMC_PRO_API_KEY']=process.env.CMC_API_KEY;
    const pages=[];
    for(const start of [1,251]){
      const u=base+'?start='+start+'&limit=250&convert=USD';
      const r=await marketFetch(u,{headers,signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error('coinmarketcap universe');
      const j=await r.json();
      if(!Array.isArray(j?.data))throw new Error('coinmarketcap response');
      pages.push(...j.data);
    }
    const market=pages.slice(0,500);
    // Enrich the CMC market list with real coin logos from CoinGecko.
    // If the logo feed is unavailable, market data still loads normally.
    let logoMap=new Map();
    try{
      const gr=await marketFetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false',{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(gr.ok){
        const gj=await gr.json();
        if(Array.isArray(gj))for(const x of gj){
          const key=String(x.symbol||'').toUpperCase();
          if(key&&!logoMap.has(key))logoMap.set(key,String(x.image||''));
        }
      }
      const gr2=await marketFetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2&sparkline=false',{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(gr2.ok){
        const gj2=await gr2.json();
        if(Array.isArray(gj2))for(const x of gj2){
          const key=String(x.symbol||'').toUpperCase();
          if(key&&!logoMap.has(key))logoMap.set(key,String(x.image||''));
        }
      }
    }catch{}
    const seen=new Set(),v=[];
    for(const c of market){
      const symbol=String(c.symbol||'').toUpperCase();
      const pair=symbol+'USDT';
      if(!symbol||seen.has(pair))continue;
      seen.add(pair);
      symbols[pair]=symbol;
      const quote=c.quote?.USD||{};
      const image=logoMap.get(symbol)||'';
      symbolMeta.set(pair,{symbol,coingeckoId:null,marketCap:quote.market_cap||0,marketCapRank:c.cmc_rank||null,name:c.name||symbol,image});

      v.push({pair,symbol,name:c.name||symbol,marketCap:quote.market_cap??null,marketCapRank:c.cmc_rank??null,image,change24h:quote.percent_change_24h??null,price:quote.price??null,volume24h:quote.volume_24h??null,circulatingSupply:c.circulating_supply??null,totalSupply:c.total_supply??null,maxSupply:c.max_supply??null,chartable:true,provider:'CoinMarketCap live market feed'});
    }
    if(v.length<100)throw new Error('coinmarketcap insufficient');
    cache.set('__universe',{t:now,v});
    persistUniverse(v,now);
    return v;
  }catch{
    const previous=cache.get('__universe')?.v;
    if(Array.isArray(previous)&&previous.length>=100)return previous;
    // Last-resort compatibility fallback. This is only used when CMC and the
    // persisted cache are both unavailable.
    const fallback=Object.entries(symbols).map(([pair,symbol])=>{const m=symbolMeta.get(pair)||{};return {pair,symbol,name:m.name||symbol,image:m.image||null,marketCap:m.marketCap||0,marketCapRank:m.marketCapRank||null,change24h:null,price:null,volume24h:null,circulatingSupply:null,totalSupply:null,maxSupply:null,chartable:true,provider:'Fallback market feed'};});
    cache.set('__universe',{t:now,v:fallback});
    return fallback;
  }finally{universeInflight=null;}}
  )();
  return universeInflight;
}

async function marketFetch(url,init={}){try{const r=await fetch(url,{...init,signal:init.signal||AbortSignal.timeout(9000)});if(r.ok)return r;throw new Error('market_http_'+r.status);}catch{const proxies=['https://api.allorigins.win/raw?url='+encodeURIComponent(url),'https://r.jina.ai/'+url];for(const p of proxies){try{const r=await fetch(p,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(r.ok)return r;}catch{}}throw new Error('market_provider_unavailable');}}
async function binanceKlines(symbol,interval,limit=250){const configured=(process.env.MARKET_BASE_URL||'').replace(/\/$/,'');const bases=[configured,'https://data-api.binance.vision','https://api.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'].filter((v,i,a)=>v&&!a.slice(0,i).includes(v));let last=null;for(const base of bases){try{const u=`${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(3500)});if(r.ok){const data=await r.json();if(Array.isArray(data)&&data.length)return data;}last=new Error('binance');}catch(e){last=e;}}throw last||new Error('binance');}
function providerInterval(tf){return {'1m':60,'15m':900,'1h':3600,'4h':21600,'1d':86400}[tf]||900;}
async function coinbaseKlines(symbol,tf,limit=250){const base=symbol.replace(/USDT$/,'')+'-USD';const sourceTf=tf==='4h'?'1h':tf;const g=providerInterval(sourceTf);const fetchLimit=tf==='4h'?Math.min(300,Math.max(120,limit*4)):limit;const end=Math.floor(Date.now()/1000),start=end-g*fetchLimit;const u=`https://api.exchange.coinbase.com/products/${encodeURIComponent(base)}/candles?granularity=${g}&start=${new Date(start*1000).toISOString()}&end=${new Date(end*1000).toISOString()}`;const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('coinbase');const data=await r.json();if(!Array.isArray(data)||!data.length)throw new Error('coinbase');const rows=data.reverse().map(x=>[Number(x[0])*1000,Number(x[3]),Number(x[2]),Number(x[1]),Number(x[4]),Number(x[5])]);if(tf!=='4h')return rows;const out=[];for(let i=0;i+3<rows.length;i+=4){const g4=rows.slice(i,i+4);out.push([g4[0][0],g4[0][1],Math.max(...g4.map(x=>x[2])),Math.min(...g4.map(x=>x[3])),g4[3][4],g4.reduce((s,x)=>s+Number(x[5]||0),0)]);}return out.slice(-limit);}
async function krakenKlines(symbol,tf,limit=250){const map={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD',AVAXUSDT:'AVAXUSD',LINKUSDT:'LINKUSD',DOTUSDT:'DOTUSD',LTCUSDT:'LTCUSD',TRXUSDT:'TRXUSD'};const pair=map[symbol]||symbol.replace(/USDT$/,'')+'USD';const interval={'1m':1,'15m':15,'1h':60,'4h':240,'1d':1440}[tf]||15;const u=`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('kraken');const j=await r.json();const key=Object.keys(j.result||{}).find(k=>k!=='last');const data=key?j.result[key]:[];if(!data.length)throw new Error('kraken');return data.slice(-limit).map(x=>[Number(x[0])*1000,Number(x[1]),Number(x[2]),Number(x[3]),Number(x[4]),Number(x[6])]);}
function ema(a,n){if(a.length<n)return null;const k=2/(n+1);let e=a.slice(0,n).reduce((s,v)=>s+v,0)/n;for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function rsi(a,n=14){if(a.length<=n)return null;let g=0,l=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}let ag=g/n,al=l/n;for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(n-1)+(d>0?d:0))/n;al=(al*(n-1)+(d<0?-d:0))/n;}return al===0?100:100-100/(1+ag/al);}
function atr(rows,n=14){if(rows.length<=n)return null;const trs=[];for(let i=1;i<rows.length;i++){const h=rows[i].h,l=rows[i].l,pc=rows[i-1].c;trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}return trs.slice(-n).reduce((s,v)=>s+v,0)/Math.min(n,trs.length);}
function analyze(rows){const closes=rows.map(x=>x.c),vols=rows.map(x=>x.v),cur=closes.at(-1),e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),r=rsi(closes),a=atr(rows);const mom=closes.length>28?cur/closes.at(-29)-1:cur/closes[0]-1,avgVol=vols.slice(-20).reduce((s,v)=>s+v,0)/Math.min(20,vols.length),vr=avgVol?vols.at(-1)/avgVol:0;const recent=rows.slice(-50),support=Math.min(...recent.map(x=>x.l)),resistance=Math.max(...recent.map(x=>x.h));let bull=0;if(e20&&cur>e20)bull+=16;if(e50&&cur>e50)bull+=14;if(e200&&cur>e200)bull+=12;if(r>=50&&r<=68)bull+=16;else if(r>68&&r<75)bull+=8;else if(r<35)bull+=3;if(mom>0)bull+=16;if(vr>=1.2)bull+=10;if(cur>support*1.01)bull+=4;bull=Math.max(0,Math.min(100,Math.round(bull)));let bear=100-bull;let risk=30;if(a)risk+=Math.min(32,(a/cur)*100*6);if(r>75||r<25)risk+=12;if(vr>2)risk+=8;risk=Math.max(5,Math.min(95,Math.round(risk)));let setup='NEUTRAL';if(bull>=72&&risk<70)setup='BULLISH_SETUP';else if(bear>=72&&risk<70)setup='BEARISH_SETUP';const long={entry:cur,stop:a?cur-a*1.5:null,tp1:a?cur+a*1.5:null,tp2:a?cur+a*3:null};const short={entry:cur,stop:a?cur+a*1.5:null,tp1:a?cur-a*1.5:null,tp2:a?cur-a*3:null};return{price:cur,rsi:r,ema20:e20,ema50:e50,ema200:e200,atr:a,momentum:mom,volumeRatio:vr,support,resistance,bullScore:bull,bearScore:bear,riskScore:risk,setup,tradeLevels:{long,short}};}
async function geckoKlines(symbol,tf,limit=250){const ids={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',XRP:'ripple',DOGE:'dogecoin',ADA:'cardano',AVAX:'avalanche-2',LINK:'chainlink',DOT:'polkadot',LTC:'litecoin',TRX:'tron'};const id=symbolMeta.get(symbol+'USDT')?.coingeckoId||ids[symbol];if(!id)throw new Error('gecko');const days=tf==='1d'?90:tf==='4h'?30:tf==='1h'?14:1;const u=`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`;const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('gecko_ohlc');const data=await r.json();if(!Array.isArray(data)||!data.length)throw new Error('gecko_ohlc');return data.slice(-limit).map(x=>[Number(x[0]),Number(x[1]),Number(x[2]),Number(x[3]),Number(x[4]),0]);}
async function geckoSnapshot(symbol){const ids={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',XRP:'ripple',DOGE:'dogecoin',ADA:'cardano',AVAX:'avalanche-2',LINK:'chainlink',DOT:'polkadot',LTC:'litecoin',TRX:'tron'};const id=ids[symbol];if(!id)throw new Error('gecko');const u=`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('gecko');const d=(await r.json())[id];if(!d?.usd)throw new Error('gecko');return{price:d.usd,change24h:d.usd_24h_change??null,volume24h:d.usd_24h_vol??null};}
async function getAnalysis(pair,tf,limit=250){
  const key=pair+tf,now=Date.now(),c=cache.get(key);
  if(c&&now-c.t<10000)return c.v;
  const providers=[
    ['coingecko',()=>geckoKlines(symbols[pair],tf,250)],
    ['kraken',()=>krakenKlines(pair,tf,250)],
    ['coinbase',()=>coinbaseKlines(pair,tf,250)],
    ...(process.env.ENABLE_BINANCE_FALLBACK!=='false'?[['binance',()=>binanceKlines(pair,tf,250)]]:[])
  ];
  for(const [provider,load] of providers){
    try{
      const raw=await load();
      const rows=raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
      if(rows.length<Math.min(20,limit))throw new Error(provider+'_insufficient');
      const v={symbol:symbols[pair],pair,tf,provider,updatedAt:new Date().toISOString(),candles:rows.map(x=>[x.t,x.o,x.h,x.l,x.c,x.v]),analysis:analyze(rows)};
      cache.set(key,{t:now,v});
      return v;
    }catch{}
  }
  try{
    const s=await geckoSnapshot(symbols[pair]);
    const change=Number(s.change24h||0);
    const v={symbol:symbols[pair],pair,tf,provider:'coingecko_snapshot',updatedAt:new Date().toISOString(),candles:[],analysis:{
      price:s.price,rsi:null,ema20:null,ema50:null,ema200:null,atr:null,
      momentum:change/100,volumeRatio:null,support:null,resistance:null,
      bullScore:change>0?60:40,bearScore:change<0?60:40,riskScore:50,
      setup:'SNAPSHOT_ONLY',tradeLevels:{long:null,short:null}
    }};
    cache.set(key,{t:now,v});
    return v;
  }catch{
    throw new Error('market_unavailable');
  }
}
app.post('/api/ai-memory/snapshot',optionalAuth,async(req,res)=>{try{const symbol=String(req.body?.symbol||'').toUpperCase(),tf=String(req.body?.tf||'1h');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});const j=await getAnalysis(symbol,tf),a=j.analysis,bias=aiMemoryBias(a);const nowCut=new Date(Date.now()-30*60*1000).toISOString();const recent=db.prepare("SELECT id FROM ai_predictions WHERE symbol=? AND tf=? AND created_at>=? ORDER BY created_at DESC LIMIT 1").get(symbol,tf,nowCut);if(!recent){const levels=bias==='SHORT'?a.tradeLevels?.short:a.tradeLevels?.long;db.prepare('INSERT INTO ai_predictions(user_id,symbol,tf,bias,entry,stop,tp1,tp2,source) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user?.id||null,symbol,tf,bias,levels?.entry??a.price,levels?.stop??null,levels?.tp1??null,levels?.tp2??null,'live');}res.json({ok:true,summary:aiMemorySummary(symbol,tf)});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});
app.get('/api/ai-memory/summary',optionalAuth,async(req,res)=>{try{const symbol=String(req.query.symbol||'').toUpperCase(),tf=String(req.query.tf||'1h');if(!tfMap[tf]||!symbols[symbol])return res.status(400).json({error:'invalid_market'});const j=await getAnalysis(symbol,tf);const rows=db.prepare("SELECT * FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);aiMemoryEvaluate(rows,j.analysis?.price);const summary=aiMemorySummary(symbol,tf);if(req.user?.plan==='premium')return res.json({ok:true,premium:true,summary,history:db.prepare("SELECT id,symbol,tf,bias,entry,stop,tp1,tp2,created_at,resolved_at,status,outcome FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf)});return res.json({ok:true,premium:false,summary:{total:summary.total,resolved:summary.resolved,wins:summary.wins,accuracy:summary.accuracy,pending:summary.pending,last:summary.last?{bias:summary.last.bias,created_at:summary.last.created_at,status:summary.last.status}:null}});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});
app.get('/api/ai-memory/history',auth,premium,async(req,res)=>{try{const symbol=String(req.query.symbol||'').toUpperCase(),tf=String(req.query.tf||'1h');const rows=db.prepare("SELECT id,symbol,tf,bias,entry,stop,tp1,tp2,created_at,resolved_at,status,outcome FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);res.json({ok:true,history:rows});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});
app.get('/api/trader-edge',async(req,res)=>{try{await refreshMarketUniverse();const results=[];const pairs=Object.keys(symbols).slice(0,80);await Promise.all(pairs.map(async pair=>{try{const [a,b,c]=await Promise.all(['15m','1h','4h'].map(tf=>getAnalysis(pair,tf)));const x=a.analysis,y=b.analysis,z=c.analysis;const trend=(Number(y.ema20||0)>Number(y.ema50||0)?1:-1)+(Number(z.ema20||0)>Number(z.ema50||0)?1:-1);const volume=Math.max(Number(a.volumeRatio||0),Number(y.volumeRatio||0));const directional=Math.round((Math.max(Number(a.bullScore||0),Number(a.bearScore||0))*.25)+(Math.max(Number(y.bullScore||0),Number(y.bearScore||0))*.45)+(Math.max(Number(z.bullScore||0),Number(z.bearScore||0))*.30));const edge=Math.round(Math.min(99,directional+(trend===2||trend===-2?8:0)+(volume>=1.5?8:volume>=1.2?4:0)));results.push({symbol:a.symbol,pair,price:y.price,edge,trend:trend>0?'UP':trend<0?'DOWN':'MIXED',volumeRatio:volume,rsi:y.rsi,support:y.support,resistance:y.resistance,setup:y.setup,risk:y.riskScore});}catch{}}));results.sort((a,b)=>b.edge-a.edge);res.json({ok:true,updatedAt:new Date().toISOString(),items:results.slice(0,8),method:'Multi-timeframe trend + momentum + volume + risk'});}catch{res.status(503).json({error:'trader_edge_unavailable'});}});
app.get('/api/top-gainers',async(req,res)=>{try{const all=await refreshMarketUniverse();const ranked=all.filter(x=>Number.isFinite(Number(x.change24h))).sort((a,b)=>Number(b.change24h)-Number(a.change24h)).slice(0,8);res.json({ok:true,updatedAt:new Date().toISOString(),gainers:ranked});}catch{res.status(503).json({error:'gainers_unavailable'});}});
app.get('/api/market-status',async(req,res)=>{try{const all=String(req.query.refresh||'')==='1'?await refreshMarketUniverseFresh():await refreshMarketUniverse();const checks=['BTCUSDT','ETHUSDT'].map(pair=>{const symbol=symbols[pair];const row=all.find(x=>x.pair===pair||x.symbol===symbol);return{pair,provider:row?.price!=null?'CoinGecko live market feed':'Cached market feed',updatedAt:row?.updatedAt||null,online:Number.isFinite(Number(row?.price))};});res.json({ok:checks.some(x=>x.online),checkedAt:new Date().toISOString(),markets:checks});}catch{res.json({ok:false,checkedAt:new Date().toISOString(),markets:[{pair:'BTCUSDT',online:false},{pair:'ETHUSDT',online:false}]});}});
app.get('/api/market-stats',async(req,res)=>{try{const all=String(req.query.refresh||'')==='1'?await refreshMarketUniverseFresh():await refreshMarketUniverse();const valid=all.filter(x=>Number.isFinite(Number(x.price)));const changes=valid.filter(x=>Number.isFinite(Number(x.change24h)));const gainers=changes.slice().sort((a,b)=>Number(b.change24h)-Number(a.change24h)).slice(0,5);const losers=changes.slice().sort((a,b)=>Number(a.change24h)-Number(b.change24h)).slice(0,5);const totalCap=valid.reduce((n,x)=>n+Number(x.marketCap||0),0);
    const totalVolume24h=valid.reduce((n,x)=>n+Number(x.volume24h||0),0);
    const weightedChange=valid.filter(x=>Number.isFinite(Number(x.change24h))&&Number(x.marketCap)>0).reduce((n,x)=>n+Number(x.change24h)*Number(x.marketCap),0)/(valid.filter(x=>Number.isFinite(Number(x.change24h))&&Number(x.marketCap)>0).reduce((n,x)=>n+Number(x.marketCap),0)||1);
    const btc=valid.find(x=>String(x.symbol).toUpperCase()==='BTC');
    const eth=valid.find(x=>String(x.symbol).toUpperCase()==='ETH');
    const btcDominance=btc&&totalCap?Number(btc.marketCap)/totalCap*100:null;
    const ethDominance=eth&&totalCap?Number(eth.marketCap)/totalCap*100:null;
    const supplyTracked=valid.filter(x=>Number.isFinite(Number(x.circulatingSupply))).length;
    res.json({ok:true,updatedAt:new Date().toISOString(),totalAssets:all.length,totalUniverse:500,pricedAssets:valid.length,totalMarketCap:totalCap,totalVolume24h,averageChange24h:weightedChange,btcDominance,ethDominance,supplyTracked,topGainers:gainers,topLosers:losers});}catch{res.status(503).json({error:'market_stats_unavailable'});}});
app.get('/api/coins',async(req,res)=>{const q=String(req.query.q||'').toLowerCase().trim();const all=String(req.query.refresh||'')==='1'?await refreshMarketUniverseFresh():await refreshMarketUniverse();const list=all.filter(x=>!q||x.symbol.toLowerCase().includes(q)||String(x.name||'').toLowerCase().includes(q));res.json({updatedAt:new Date().toISOString(),coins:list,count:list.length,totalUniverse:500,universe:'CoinGecko top 500 by market cap',sort:'market_cap_desc'});});
app.get('/api/ai/market-intelligence',async(req,res)=>{try{const symbol=String(req.query.symbol||'BTCUSDT').toUpperCase();await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});const tfs=['1m','15m','1h','4h'];const reports=await Promise.all(tfs.map(async tf=>{try{const j=await getAnalysis(symbol,tf);return {tf,provider:j.provider,updatedAt:j.updatedAt,analysis:j.analysis};}catch{return {tf,available:false};}}));const usable=reports.filter(x=>x.analysis);if(!usable.length)return res.status(503).json({error:'market_unavailable'});const bull=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.bullScore||0),0)/usable.length);const bear=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.bearScore||0),0)/usable.length);const risk=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.riskScore||50),0)/usable.length);const trend=bull>=65?'Bullish':bear>=65?'Bearish':'Mixed';const alignment=usable.filter(x=>(trend==='Bullish'?Number(x.analysis.bullScore||0)>=60:trend==='Bearish'?Number(x.analysis.bearScore||0)>=60:true)).length;const latest=usable.find(x=>x.tf==='1h')?.analysis||usable[0].analysis;const reasoning=['Multi-timeframe trend: '+trend+'.','Timeframe alignment: '+alignment+'/'+usable.length+'.','Average bull score: '+bull+'/100; bear score: '+bear+'/100.','Average risk: '+risk+'/100.',latest.rsi!=null?'RSI: '+Number(latest.rsi).toFixed(1)+'.':'RSI unavailable.',latest.volumeRatio!=null?'Volume ratio: '+Number(latest.volumeRatio).toFixed(2)+'x.':'Volume data unavailable.'];res.json({ok:true,symbol,updatedAt:new Date().toISOString(),engine:'CryptoPilot Multi-Timeframe AI',trend,bullScore:bull,bearScore:bear,riskScore:risk,confidence:Math.max(bull,bear),reasoning,reports});}catch(e){res.status(503).json({error:'ai_market_unavailable'});}});

app.get('/api/market/:symbol',async(req,res)=>{const symbol=String(req.params.symbol||'').toUpperCase(),tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});if(!symbols[symbol]){await refreshMarketUniverse();}if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});try{res.json(await getAnalysis(symbol,tf));}catch{res.status(503).json({error:'market_unavailable'});}});
app.get('/api/scanner',async(req,res)=>{const tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();const results=[];await Promise.all(Object.keys(symbols).slice(0,100).map(async pair=>{try{const j=await getAnalysis(pair,tf),a=j.analysis;results.push({symbol:j.symbol,pair,price:a.price,bullScore:a.bullScore,bearScore:a.bearScore,riskScore:a.riskScore,setup:a.setup,rsi:a.rsi,momentum:a.momentum,volumeRatio:a.volumeRatio,provider:j.provider});}catch{}}));results.sort((a,b)=>Math.max(b.bullScore,b.bearScore)-Math.max(a.bullScore,a.bearScore));res.json({tf,updatedAt:new Date().toISOString(),results,count:results.length});});

// Premium payment configuration and on-chain verification.
const TRON_USDT_CONTRACT='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
function paymentConfig(){
  const wallet=String(process.env.PAYMENT_WALLET||process.env.USDT_TRC20_WALLET||process.env.TRC20_WALLET||process.env.USDT_WALLET||process.env.PAYMENT_ADDRESS||process.env.WALLET_ADDRESS||'').trim();
  const amount=Number(process.env.PREMIUM_PRICE_USDT||process.env.PAYMENT_AMOUNT_USDT||process.env.PREMIUM_PRICE||process.env.PAYMENT_AMOUNT||process.env.USDT_PRICE||'');
  if(!wallet||!Number.isFinite(amount)||amount<=0)return null;
  return {wallet,amount,network:'TRC20',asset:'USDT',contract:TRON_USDT_CONTRACT,decimals:6};
}
function validTxid(txid){return /^[a-fA-F0-9]{64}$/.test(String(txid||''));}
async function fetchJson(url,headers={}){
  const r=await fetch(url,{headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('provider_http_'+r.status);
  return r.json();
}
async function inspectPaymentTx(txid,cfg){
  const apiKey=String(process.env.TRONSCAN_API_KEY||process.env.TRON_PRO_API_KEY||'').trim();
  const headers=apiKey?{'TRON-PRO-API-KEY':apiKey}:{};
  const providers=[
    async()=>fetchJson('https://apilist.tronscanapi.com/api/transaction-info?hash='+encodeURIComponent(txid),headers),
    async()=>fetchJson('https://api.trongrid.io/v1/transactions/'+encodeURIComponent(txid)+'/events?only_confirmed=true',process.env.TRONGRID_API_KEY?{'TRON-PRO-API-KEY':process.env.TRONGRID_API_KEY}:{}),
  ];
  let last=null;
  for(const get of providers){
    try{
      const j=await get();
      if(j?.trc20TransferInfo||j?.transfersAllList||j?.tokenTransferInfo){
        const transfers=[...(j.trc20TransferInfo||[]),...(j.transfersAllList||[])];
        if(j.tokenTransferInfo)transfers.push(j.tokenTransferInfo);
        const t=transfers.find(x=>String(x.symbol||'').toUpperCase()==='USDT'&&String(x.contract_address||'')===cfg.contract&&String(x.to_address||'')===cfg.wallet&&String(x.type||'Transfer').toLowerCase()==='transfer');
        if(!t)return {status:'payment_mismatch',provider:'tronscan',confirmed:Boolean(j.confirmed),reverted:Boolean(j.revert),txid};
        const decimals=Number(t.decimals??cfg.decimals);
        const rawAmount=Number(t.amount_str);
        const amount=rawAmount/10**decimals;
        if(!j.confirmed||j.revert||String(j.contractRet||'').toUpperCase()!=='SUCCESS'||Number(t.status||0)!==0)return {status:'pending',provider:'tronscan',confirmed:Boolean(j.confirmed),txid,amount};
        return {status:Math.abs(amount-cfg.amount)<1e-9?'confirmed':'payment_mismatch',provider:'tronscan',confirmed:true,txid,amount};
      }
      const events=Array.isArray(j?.data)?j.data:[];
      const t=events.find(x=>String(x.event_name||x.eventName||'').toLowerCase()==='transfer');
      if(t){
        const v=t.result||t;
        const to=String(v.to||v._to||''); const contract=String(t.contract_address||v.contract_address||'');
        const raw=Number(v.value??v._value??v.amount??0); const amount=raw/1e6;
        if(to===cfg.wallet&&contract===cfg.contract)return {status:Math.abs(amount-cfg.amount)<1e-9?'confirmed':'payment_mismatch',provider:'trongrid',confirmed:true,txid,amount};
      }
      last=new Error('tx_not_found');
    }catch(e){last=e;}
  }
  if(last?.message==='tx_not_found')return {status:'payment_mismatch',txid};
  throw new Error('verification_unavailable');
}
app.get('/api/payment/config',(req,res)=>{
  const cfg=paymentConfig();
  if(!cfg)return res.status(503).json({error:'payment_not_configured'});
  res.json({ok:true,amount:cfg.amount,network:cfg.network,asset:cfg.asset,wallet:cfg.wallet,contract:cfg.contract,decimals:cfg.decimals});
});
app.get('/api/payment/status',optionalAuth,(req,res)=>{const cfg=paymentConfig();res.json({ok:true,configured:Boolean(cfg),signedIn:Boolean(req.user),premium:req.user?.plan==='premium',network:'TRC20',asset:'USDT',automaticVerification:Boolean(cfg)});});
app.get('/api/payment/verification-engine',(req,res)=>{
  const cfg=paymentConfig();
  res.json({ok:Boolean(cfg),automatic:Boolean(cfg),provider:'TRONSCAN + TronGrid',network:'TRC20',asset:'USDT'});
});
async function verifyPaymentForUser(req,txid){
  const cfg=paymentConfig();
  if(!cfg)throw Object.assign(new Error('payment_not_configured'),{code:'payment_not_configured'});
  if(!validTxid(txid))throw Object.assign(new Error('invalid_txid'),{code:'invalid_txid'});
  const existing=db.prepare('SELECT * FROM payments WHERE event_id=?').get(txid);
  if(existing&&Number(existing.user_id)!==Number(req.user.id))throw Object.assign(new Error('txid_already_claimed'),{code:'txid_already_claimed'});
  const result=await inspectPaymentTx(txid,cfg);
  if(result.status==='confirmed'){
    const amountRaw=Math.round(cfg.amount*10**cfg.decimals);
    db.prepare("INSERT INTO payments(user_id,event_id,provider,status,amount,currency,authority) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET status=excluded.status,amount=excluded.amount,currency=excluded.currency,authority=excluded.authority").run(req.user.id,txid,result.provider,'confirmed',amountRaw,'USDT',cfg.wallet);
    const days=Math.max(1,Number(process.env.PREMIUM_DAYS||30));const current=db.prepare('SELECT premium_until FROM users WHERE id=?').get(req.user.id);const base=current?.premium_until&&new Date(current.premium_until).getTime()>Date.now()?new Date(current.premium_until):new Date();const until=new Date(base.getTime()+days*86400000);db.prepare("UPDATE users SET plan='premium',premium_until=? WHERE id=?").run(until.toISOString(),req.user.id);audit(req.user.id,'premium_payment_confirmed',{txid,amount:cfg.amount,network:'TRC20',premiumUntil:until.toISOString(),days});const account=db.prepare('SELECT email FROM users WHERE id=?').get(req.user.id);if(account?.email)sendAccountEmail(account.email,'CryptoPilot AI Premium activated',`<div style="font-family:Arial,sans-serif"><h2>Your Premium access is active 🎉</h2><p>Your CryptoPilot AI Premium subscription has been activated.</p><p><b>Duration:</b> ${days} days</p><p><b>Expires:</b> ${until.toISOString().slice(0,10)}</p><p>You can view your remaining days from your Account page.</p></div>`).catch(()=>{});
    audit(req.user.id,'premium_payment_confirmed',{txid,amount:cfg.amount,network:'TRC20'});
    return {status:'confirmed',amount:cfg.amount,network:'TRC20',txid};
  }
  const st=result.status==='pending'?'pending':'mismatch';
  db.prepare("INSERT INTO payments(user_id,event_id,provider,status,amount,currency,authority) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET status=excluded.status,provider=excluded.provider").run(req.user.id,txid,result.provider||'tronscan',st,Math.round(cfg.amount*10**cfg.decimals),'USDT',cfg.wallet);
  return {status:st,txid,amount:result.amount??null};
}
app.post('/api/payment/submit',auth,async(req,res)=>{
  try{
    const txid=String(req.body?.txid||'').trim();
    if(!validTxid(txid))return res.status(400).json({error:'invalid_txid'});
    const r=await verifyPaymentForUser(req,txid);
    res.json({ok:true,...r});
  }catch(e){
    const code=e?.code||e?.message;
    if(code==='txid_already_claimed')return res.status(409).json({error:code});
    if(code==='payment_not_configured')return res.status(503).json({error:code});
    if(code==='verification_unavailable')return res.status(503).json({error:code});
    res.status(400).json({error:code||'payment_verification_failed'});
  }
});
app.post('/api/payment/verify',auth,async(req,res)=>{
  try{
    const txid=String(req.body?.txid||'').trim();
    if(!validTxid(txid))return res.status(400).json({error:'invalid_txid'});
    const r=await verifyPaymentForUser(req,txid);
    res.json({ok:true,...r});
  }catch(e){
    const code=e?.code||e?.message;
    if(code==='txid_already_claimed')return res.status(409).json({error:code});
    if(code==='payment_not_configured'||code==='verification_unavailable')return res.status(503).json({error:code});
    res.status(400).json({error:code||'payment_verification_failed'});
  }
});

app.get('/account.html',(req,res)=>res.sendFile('account.html',{root:'public'}));
app.get('/robots.txt',(req,res)=>{const base=process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);});
app.get('/sitemap.xml',(req,res)=>{const base=(process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');const slugs=['bitcoin','ethereum','solana','binance-coin','xrp','dogecoin','cardano','avalanche','chainlink','polkadot','litecoin','tron'];const urls=['/','/market-analysis','/ai-crypto-chart-analysis',...slugs.map(s=>`/crypto/${s}`)];res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${base}${u}</loc><changefreq>${u==='/'?'daily':'hourly'}</changefreq><priority>${u==='/'?'1.0':'0.8'}</priority></url>`).join('')}</urlset>`);});
app.get('/market-analysis',(req,res)=>res.sendFile('index.html',{root:'public'}));
app.get('/ai-crypto-chart-analysis',(req,res)=>res.sendFile('ai-crypto-chart-analysis.html',{root:'public'}));
app.get('/crypto/:slug',(req,res)=>res.sendFile('index.html',{root:'public'}));
app.post('/api/alerts',auth,(req,res)=>{const symbol=String(req.body?.symbol||'').toUpperCase(),target=Number(req.body?.target),direction=req.body?.direction==='below'?'below':'above';if(!Object.values(symbols).includes(symbol)||!Number.isFinite(target)||target<=0)return res.status(400).json({error:'invalid_alert'});const r=db.prepare('INSERT INTO alerts(user_id,symbol,target,direction) VALUES(?,?,?,?)').run(req.user.id,symbol,target,direction);audit(req.user.id,'alert_create',{symbol,target,direction});res.json({id:r.lastInsertRowid});});
app.get('/api/alerts',auth,(req,res)=>res.json(db.prepare('SELECT id,symbol,target,direction,active,triggered_at,created_at FROM alerts WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.delete('/api/alerts/:id',auth,(req,res)=>{db.prepare('DELETE FROM alerts WHERE id=? AND user_id=?').run(Number(req.params.id),req.user.id);audit(req.user.id,'alert_delete',{id:req.params.id});res.json({ok:true});});
async function checkAlerts(){const alerts=db.prepare('SELECT * FROM alerts WHERE active=1').all();for(const al of alerts){try{const pair=Object.entries(symbols).find(([,v])=>v===al.symbol)?.[0];if(!pair)continue;const j=await getAnalysis(pair,'15m');const price=j.analysis.price;const hit=al.direction==='above'?price>=al.target:price<=al.target;if(hit){db.prepare('UPDATE alerts SET active=0,triggered_at=CURRENT_TIMESTAMP WHERE id=?').run(al.id);audit(al.user_id,'alert_triggered',{symbol:al.symbol,target:al.target,price});}}catch{}}}
setInterval(()=>checkAlerts().catch(()=>{}),30000);
const chartAiCache=new Map();
function assetProfile(symbol,name=''){
  const s=String(symbol||'').toUpperCase(), n=String(name||'').toLowerCase();
  const profiles={
    BTC:{sector:'Store of value / digital monetary asset',use:'Bitcoin is primarily used as a decentralized monetary network and scarce digital asset.',drivers:'ETF/institutional flows, liquidity, macro rates, dollar strength, miner economics and network activity.'},
    ETH:{sector:'Smart-contract infrastructure / Layer 1',use:'Ethereum provides programmable settlement for decentralized applications, DeFi and tokenized assets.',drivers:'network activity, fees/burn, staking, L2 activity, institutional flows and ecosystem growth.'},
    SOL:{sector:'Smart-contract infrastructure / high-throughput Layer 1',use:'Solana targets fast, low-cost on-chain applications, trading and consumer crypto activity.',drivers:'network activity, DEX volume, stablecoin flows, app adoption and validator/network health.'},
    BNB:{sector:'Exchange ecosystem / Layer 1',use:'BNB is the core asset of the Binance ecosystem and BNB Chain.',drivers:'exchange activity, BNB Chain usage, token utility and regulatory/exchange developments.'},
    XRP:{sector:'Payments / settlement network',use:'XRP is designed for fast value transfer and liquidity within payment and settlement infrastructure.',drivers:'payment adoption, liquidity, legal/regulatory developments and network activity.'},
    DOGE:{sector:'Meme / payments-oriented cryptocurrency',use:'Dogecoin is a high-liquidity community-driven asset with payment and tipping use cases.',drivers:'market sentiment, liquidity, social attention and broader crypto risk appetite.'},
    ADA:{sector:'Smart-contract infrastructure / Layer 1',use:'Cardano is a proof-of-stake blockchain focused on programmable applications and decentralized infrastructure.',drivers:'network adoption, application activity, staking and ecosystem development.'},
    AVAX:{sector:'Smart-contract infrastructure / Layer 1',use:'Avalanche provides programmable blockchain infrastructure with a focus on scalable networks and applications.',drivers:'network activity, subnets/L1 adoption, DeFi liquidity and ecosystem growth.'},
    LINK:{sector:'Oracle / Web3 infrastructure',use:'Chainlink supplies external data and interoperability services to smart contracts.',drivers:'oracle adoption, CCIP usage, DeFi/RWA demand and integration growth.'},
    DOT:{sector:'Interoperability / Layer 0 infrastructure',use:'Polkadot focuses on interoperable blockchain infrastructure and shared security.',drivers:'network usage, parachain activity, staking and ecosystem adoption.'},
    TRX:{sector:'Payments / stablecoin settlement infrastructure',use:'TRON is a high-throughput blockchain with substantial stablecoin transfer activity.',drivers:'USDT settlement volume, network usage, fees and ecosystem liquidity.'}
  };
  if(profiles[s])return profiles[s];
  if(/ai|artificial intelligence|render|fetch|injective|near|tao|bittensor/i.test(n+' '+s))return {sector:'AI / decentralized computing',use:'This asset is associated with the AI or decentralized-compute segment; the exact utility should be checked against its project documentation.',drivers:'AI adoption, compute/data demand, ecosystem usage, token utility and speculative liquidity.'};
  if(/link|oracle/i.test(n+' '+s))return {sector:'Web3 infrastructure / oracle',use:'Infrastructure that connects blockchain applications with external data or services.',drivers:'integrations, on-chain usage, protocol revenue and ecosystem growth.'};
  if(/swap|dex|uniswap|raydium|jupiter/i.test(n+' '+s))return {sector:'DeFi / decentralized exchange',use:'Decentralized trading and liquidity infrastructure.',drivers:'DEX volume, liquidity, fees, TVL and broader risk appetite.'};
  if(/usd|stable/i.test(n+' '+s))return {sector:'Stablecoin / digital dollar',use:'A token designed to track a fiat currency value rather than maximize price appreciation.',drivers:'reserve quality, liquidity, redemption confidence and regulatory conditions.'};
  return {sector:'Crypto asset / sector requires confirmation',use:'The available market feed does not provide enough verified project metadata to classify this asset confidently.',drivers:'price liquidity, market regime, project adoption and sector-specific catalysts.'};
}
async function buildChartAiAnalysis(pair,tf,language='en'){
  const key=pair+'|'+tf,now=Date.now(),cached=chartAiCache.get(key);
  if(cached&&now-cached.t<90000)return cached.v;
  const symbol=String(symbols[pair]||pair.replace(/USDT$/,'')); 
  const meta=symbolMeta.get(pair)||{};
  const profile=assetProfile(symbol,meta.name||symbol);
  const tfs=['15m','1h','4h','1d'];
  const reports=[];
  await Promise.all(tfs.map(async x=>{try{const j=await Promise.race([getAnalysis(pair,x,250),new Promise((_,reject)=>setTimeout(()=>reject(new Error('tf_timeout')),6500))]);reports.push({tf:x,provider:j.provider,analysis:j.analysis});}catch{}}));
  if(!reports.length){
    try{
      const universe=await refreshMarketUniverse();
      const row=universe.find(x=>x.pair===pair||x.symbol===symbol);
      if(row&&Number.isFinite(Number(row.price))){
        const ch=Number(row.change24h||0);
        reports.push({tf:'1h',provider:'market-snapshot',analysis:{price:Number(row.price),rsi:null,ema20:null,ema50:null,ema200:null,atr:null,momentum:ch/100,volumeRatio:null,support:null,resistance:null,bullScore:ch>0?60:40,bearScore:ch<0?60:40,riskScore:50,setup:'MARKET_SNAPSHOT',tradeLevels:{long:null,short:null}}});
      }
    }catch{}
  }
  if(!reports.length){
    try{
      const u='https://pro-api.coinmarketcap.com/public-api/v2/simple/price?symbol='+encodeURIComponent(symbol)+'&convert=USD&skip_invalid=true';
      const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6000)});
      if(r.ok){
        const j=await r.json(),q=j?.data?.[0]?.quotes?.find(x=>x.symbol==='USD'),price=Number(q?.price);
        if(Number.isFinite(price)){
          const ch=Number(q?.percent_change_24h||0);
          reports.push({tf:'1h',provider:'CoinMarketCap live snapshot',analysis:{price,rsi:null,ema20:null,ema50:null,ema200:null,atr:null,momentum:ch/100,support:null,resistance:null,bullScore:ch>=0?60:40,bearScore:ch<0?60:40,riskScore:50,setup:'MARKET_SNAPSHOT',tradeLevels:{long:null,short:null}}});
        }
      }
    }catch{}
  }
  if(!reports.length){
    try{
      const searchUrl='https://api.coingecko.com/api/v3/search?query='+encodeURIComponent(symbol);
      const sr=await marketFetch(searchUrl,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
      if(!sr.ok)throw Error('coingecko_search');
      const sj=await sr.json();
      const exact=(sj.coins||[]).find(x=>String(x.symbol||'').toUpperCase()===symbol);
      const id=exact?.id;
      if(id){
        const pr=await marketFetch('https://api.coingecko.com/api/v3/simple/price?ids='+encodeURIComponent(id)+'&vs_currencies=usd&include_24hr_change=true',{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
        if(pr.ok){
          const pj=await pr.json(),row=pj[id],price=Number(row?.usd);
          if(Number.isFinite(price)){
            const ch=Number(row?.usd_24h_change||0);
            reports.push({tf:'1h',provider:'CoinGecko live snapshot',analysis:{price,rsi:null,ema20:null,ema50:null,ema200:null,atr:null,momentum:ch/100,support:null,resistance:null,bullScore:ch>=0?60:40,bearScore:ch<0?60:40,riskScore:50,setup:'MARKET_SNAPSHOT',tradeLevels:{long:null,short:null}}});
          }
        }
      }
    }catch{}
  }
  if(!reports.length)throw new Error('chart_ai_market_unavailable');
  reports.sort((a,b)=>tfs.indexOf(a.tf)-tfs.indexOf(b.tf));
  const primary=reports.find(x=>x.tf===tf)?.analysis||reports.find(x=>x.tf==='1h')?.analysis||reports[0].analysis;
  const payload={symbol,name:meta.name||symbol,sector:profile.sector,useCase:profile.use,drivers:profile.drivers,requestedTf:tf,primary, timeframes:reports.map(x=>({tf:x.tf,analysis:x.analysis}))};
  try{if(process.env.OPENAI_API_KEY){
    const prompt=language==='en' ? `You are CryptoPilot AI, a professional crypto market-analysis assistant. Analyze ONLY the supplied live market data and supplied asset metadata. The user wants useful, specific and readable analysis, not generic education.
Return a concise but expert report in English with exactly these headings:
1) Asset role and real-world use
2) Current chart status
3) What supports upside
4) What raises downside risk
5) Bullish scenario
6) Bearish scenario
7) Key levels and confirmation conditions
8) Smart summary
Under the bullish and bearish scenarios, use conditional language and concrete levels from the supplied data. Compare 15m/1h/4h/1d and explicitly call out timeframe disagreement. Mention RSI, EMA structure, momentum, volume, ATR/volatility, support/resistance and risk score when available. Never promise profit, never claim certainty, and never give personalized financial advice. If metadata is uncertain, say so instead of inventing facts.
DATA:\n${JSON.stringify(payload)}` : `You are CryptoPilot AI, a professional crypto market-analysis assistant. Analyze ONLY the supplied live market data and supplied asset metadata. Return a concise expert report in Persian with exactly these headings: جایگاه ارز و کاربرد واقعی، وضعیت فعلی روی چارت، چه چیزی به نفع رشد است، چه چیزی خطر سقوط را بالا می‌برد، سناریوی صعودی، سناریوی نزولی، سطوح مهم و شرط تأیید، جمع‌بندی هوشمند. Use conditional language, compare 15m/1h/4h/1d, mention available RSI/EMA/momentum/volume/ATR/support/resistance/risk, and never promise profit or personalized financial advice. DATA:\n${JSON.stringify(payload)}`;
    const r=await fetch('https://1xai.ir/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(20000)});
    if(r.ok){const j=await r.json();const v={source:'1xai',model:process.env.OPENAI_MODEL||'gpt-5.6-luna',symbol,name:meta.name||symbol,sector:profile.sector,useCase:profile.use,drivers:profile.drivers,updatedAt:new Date().toISOString(),analysis:primary,report:j.choices?.[0]?.message?.content||''};chartAiCache.set(key,{t:now,v});return v;}
  }}catch{}
  const bull=Number(primary.bullScore||0),bear=Number(primary.bearScore||0),risk=Number(primary.riskScore||50);
  const trend=bull>bear+8?'متمایل به صعود':bear>bull+8?'متمایل به نزول':'خنثی / نیازمند تأیید';
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'نامشخص';
  const tfRows=reports.map(x=>({tf:x.tf,a:x.analysis||{}}));
  const tfBias=a=>Number(a.bullScore||0)>Number(a.bearScore||0)+8?'صعودی':Number(a.bearScore||0)>Number(a.bullScore||0)+8?'نزولی':'خنثی';
  const tfSummary=tfRows.map(x=>`${x.tf}: ${tfBias(x.a)} | RSI ${fmt(x.a.rsi,1)} | مومنتوم ${Number.isFinite(Number(x.a.momentum))?(Number(x.a.momentum)*100).toFixed(2)+'%':'نامشخص'} | حجم ${fmt(x.a.volumeRatio,2)}x`).join('؛ ');
  const bullishTfs=tfRows.filter(x=>tfBias(x.a)==='صعودی').length;
  const bearishTfs=tfRows.filter(x=>tfBias(x.a)==='نزولی').length;
  const alignment=bullishTfs>bearishTfs?'غلبه با تایم‌فریم‌های صعودی است':bearishTfs>bullishTfs?'غلبه با تایم‌فریم‌های نزولی است':'تایم‌فریم‌ها اجماع روشنی ندارند';
  const emaState=primary.ema20&&primary.ema50
    ? (primary.price>primary.ema20&&primary.ema20>primary.ema50?'چینش کوتاه‌مدت مثبت':primary.price<primary.ema20&&primary.ema20<primary.ema50?'چینش کوتاه‌مدت منفی':'چینش EMAها ترکیبی است')
    :'اطلاعات کافی برای ساختار EMA در دسترس نیست';
  const confirmation=primary.resistance!=null
    ? `تأیید صعود: تثبیت بالای مقاومت ${fmt(primary.resistance)} همراه با حجم بالاتر از میانگین. تأیید نزولی: شکست حمایت ${fmt(primary.support)} و تأیید در تایم‌فریم بالاتر. این سطوح با ورود داده جدید باید دوباره محاسبه شوند.`
    : 'برای تأیید حرکت، شکست سطح کلیدی همراه با افزایش حجم و تأیید تایم‌فریم بالاتر لازم است.';
  const report=`1) جایگاه ارز و کاربرد واقعی
${profile.sector}. ${profile.use}
محرک‌های اصلی این دارایی: ${profile.drivers}

2) وضعیت فعلی روی چارت
قیمت ${fmt(primary.price)} است و وضعیت تکنیکال تایم‌فریم انتخابی ${trend} است. RSI ${fmt(primary.rsi,1)}، مومنتوم ${Number.isFinite(Number(primary.momentum))?(Number(primary.momentum)*100).toFixed(2)+'%':'نامشخص'}، نسبت حجم ${fmt(primary.volumeRatio,2)}x، ATR ${fmt(primary.atr)} و امتیاز ریسک ${risk}/100 است. ${emaState}.
نمای چندتایم‌فریمی: ${tfSummary}. ${alignment}.

3) چه چیزی به نفع رشد است
قیمت بالاتر از EMAهای کوتاه‌تر، مومنتوم مثبت، RSI در محدوده غیر افراطی و افزایش حجم در شکست مقاومت می‌توانند حرکت صعودی را تقویت کنند. در داده فعلی، امتیاز صعودی ${bull}/100 است؛ این امتیاز احتمال آینده را تضمین نمی‌کند.

4) چه چیزی خطر سقوط را بالا می‌برد
از دست رفتن حمایت ${fmt(primary.support)}، افزایش نوسان نسبت به ATR، افت مومنتوم یا افزایش حجم فروش می‌تواند ساختار را تضعیف کند. اختلاف بین تایم‌فریم‌ها نیز باید جدی گرفته شود؛ سیگنال کوتاه‌مدت به‌تنهایی تأیید روند بزرگ‌تر نیست.

5) سناریوی صعودی
اگر قیمت بالای ${fmt(primary.resistance)} تثبیت شود و حجم تأییدکننده افزایش یابد، ساختار صعودی تقویت می‌شود. در این حالت مقاومت بعدی باید از داده جدید و ساختار بازار محاسبه شود، نه با یک هدف ثابت از پیش تعیین‌شده.

6) سناریوی نزولی
اگر قیمت حمایت ${fmt(primary.support)} را از دست بدهد و تایم‌فریم 4h یا 1d نیز شکست را تأیید کند، فشار فروش می‌تواند افزایش یابد. اگر حمایت حفظ شود، این سناریو تأیید نشده باقی می‌ماند.

7) سطوح مهم و شرط تأیید
حمایت: ${fmt(primary.support)} | مقاومت: ${fmt(primary.resistance)} | ATR: ${fmt(primary.atr)}
${confirmation}

8) جمع‌بندی هوشمند
این تحلیل بدون API پولی و فقط با داده زنده تکنیکال CryptoPilot تولید شده است. برای تصمیم‌گیری قطعی یا تضمین سود نیست؛ تغییر قیمت و اختلاف تایم‌فریم‌ها می‌تواند نتیجه را تغییر دهد.`;
  const v={source:'technical-fallback',symbol,name:meta.name||symbol,sector:profile.sector,useCase:profile.use,drivers:profile.drivers,updatedAt:new Date().toISOString(),analysis:primary,timeframes:tfRows.map(x=>({tf:x.tf,bias:tfBias(x.a),analysis:x.a})),report};
  chartAiCache.set(key,{t:now,v});return v;
}
function buildAiQuestionAnswer(question, v){
  const a=v.analysis||{}, q=String(question||'').trim();
  const fmt=(x,d=4)=>Number.isFinite(Number(x))?Number(x).toLocaleString('en-US',{maximumFractionDigits:d}):'نامشخص';
  const bull=Number(a.bullScore||0),bear=Number(a.bearScore||0),risk=Number(a.riskScore||50);
  const bias=bull>bear+8?'صعودی':bear>bull+8?'نزولی':'خنثی / نیازمند تأیید';
  const rsi=fmt(a.rsi,1),support=fmt(a.support),resistance=fmt(a.resistance),price=fmt(a.price);
  const buying=/(خرید|buy|بخر|ورود|لانگ|سرمایه)/i.test(q);
  const reason=/(چرا|دلیل|رشد|ریزش|علت|why)/i.test(q);
  const riskQ=/(ریسک|خطر|stop|ضرر)/i.test(q);
  const asOf=new Date().toLocaleString('fa-IR',{timeZone:'Asia/Tehran'});
  let answer='در زمان '+asOf+'، قیمت مرجع '+price+' است. این پاسخ از داده زنده و تحلیل چندتایم‌فریمی CryptoPilot ساخته شده و با تغییر بازار باید دوباره محاسبه شود.\n\n';
  answer+='وضعیت فعلی: '+bias+'. RSI برابر '+rsi+'، امتیاز صعودی '+bull+'/100، امتیاز نزولی '+bear+'/100 و ریسک '+risk+'/100 است. حمایت مهم '+support+' و مقاومت مهم '+resistance+' است.\n\n';
  answer+='کوتاه‌مدت (15m/1h): '+bias+'. برای حرکت صعودی، عبور و تثبیت بالای مقاومت همراه با حجم بهتر مهم است؛ شکست حمایت می‌تواند فشار فروش را بیشتر کند.\n\n';
  answer+='میان‌مدت (4h): باید دید حرکت کوتاه‌مدت در این تایم‌فریم تأیید می‌شود یا نه. اگر 4h همسو شود، اعتبار روند بیشتر می‌شود؛ اختلاف 4h با 15m/1h یعنی هنوز تأیید کامل نداریم.\n\n';
  answer+='بلندمدت (1d): روند روزانه مهم‌تر از نوسان‌های چندساعته است. برای دید بلندمدت، حفظ ساختار بالای حمایت‌های اصلی و بهبود مومنتوم و حجم اهمیت دارد؛ یک حرکت کوتاه‌مدت به‌تنهایی روند روزانه را عوض نمی‌کند.';
  if(buying) answer+='\n\nدرباره خرید: خرید قطعی یا تضمین سود ارائه نمی‌کنم. اگر هدف ورود است، شرط ورود مهم‌تر از صرفاً قیمت فعلی است: یا شکست و تثبیت معتبر مقاومت با حجم، یا برگشت تأییدشده از حمایت. ورود وسط یک حرکت بدون تأیید، ریسک تعقیب قیمت را بالا می‌برد.';
  if(reason) answer+='\n\nمهم‌ترین محرک‌ها: مومنتوم، ساختار EMA، حجم معاملات، RSI، حمایت و مقاومت و هم‌جهتی تایم‌فریم‌ها. عوامل بنیادی و اخبار پروژه هم باید جداگانه بررسی شوند؛ تحلیل تکنیکال به‌تنهایی علت بنیادی را ثابت نمی‌کند.';
  if(riskQ) answer+='\n\nریسک: امتیاز فعلی '+risk+'/100 است. سه هشدار اصلی را زیر نظر بگیر: شکست حمایت، افزایش نوسان/ATR، و تأیید نشدن حرکت در 4h یا 1d.';
  answer+='\n\nجمع‌بندی: '+bias+'. سناریوی صعودی با تأیید قیمت و حجم قوی‌تر می‌شود و سناریوی نزولی با شکست حمایت و تأیید تایم‌فریم بالاتر. این پاسخ آموزشی است و تضمین سود یا توصیه مالی شخصی نیست.';
  return answer;
}

app.post('/api/ai/ask',optionalAuth,aiLimit,async(req,res)=>{
  const pair=String(req.body?.symbol||'BTCUSDT').toUpperCase();
  const question=String(req.body?.question||'').trim().slice(0,1000);
  const language=(()=>{const x=String(req.body?.language||'en').toLowerCase();return x==='fa'||x==='ru'?x:'en';})();
  if(!question)return res.status(400).json({error:'question_required'});
  if(!symbols[pair])await refreshMarketUniverse();
  if(!symbols[pair])return res.status(400).json({error:'unsupported_market'});
  try{
    let v;
    try{
      v=await Promise.race([
        buildChartAiAnalysis(pair,'1h',language),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('ai_chart_timeout')),12000))
      ]);
    }catch{
      const cached=cache.get(pair+'1h')?.v;
      const live=cached||await Promise.race([
        getAnalysis(pair,'1h'),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('ai_fallback_timeout')),6000))
      ]);
      const meta=symbolMeta.get(pair)||{};
      const profile=assetProfile(symbols[pair],meta.name||symbols[pair]);
      v={
        symbol:symbols[pair],
        name:meta.name||symbols[pair],
        sector:profile.sector,
        useCase:profile.use,
        drivers:profile.drivers,
        analysis:live.analysis,
        timeframes:[{tf:'1h',analysis:live.analysis}],
        updatedAt:new Date().toISOString(),
        source:'technical-fallback'
      };
    }
    try{if(process.env.OPENAI_API_KEY){
      const context={symbol:v.symbol,sector:v.sector,useCase:v.useCase,analysis:v.analysis,timeframes:v.timeframes};
      const prompt=language==='en'?'You are CryptoPilot AI. Answer the user crypto question in clear, natural English using ONLY the supplied live market data and asset metadata. Start from the exact current timestamp. If the question asks whether to buy, do not give a guaranteed yes/no; explain conditions and risks. Cover short-term, medium-term and long-term views when relevant. Explain RSI, EMA, momentum, volume, support/resistance and timeframe agreement simply. Be specific, concise but complete. Never promise profit.\nUser question: '+question+'\nDATA: '+JSON.stringify(context):'You are CryptoPilot AI. Answer the user crypto question in clear Persian using ONLY the supplied live market data and asset metadata. Start from the exact current timestamp. Explain conditions and risks, short/medium/long term when relevant, RSI, EMA, momentum, volume, support/resistance and timeframe agreement. Never promise profit.\nUser question: '+question+'\nDATA: '+JSON.stringify(context);
      const rr=await fetch('https://1xai.ir/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(20000)});
      if(rr.ok){const j=await rr.json();return res.json({ok:true,source:'1xai',symbol:v.symbol,asOf:new Date().toISOString(),answer:(String(j.choices?.[0]?.message?.content||'').trim().length>=200?String(j.choices[0].message.content).trim():buildAiQuestionAnswer(question,v))});}
      }
    }catch{}
    res.json({ok:true,source:'technical-engine',symbol:v.symbol,asOf:new Date().toISOString(),answer:buildAiQuestionAnswer(question,v)});
  }catch{res.status(503).json({error:'ai_question_unavailable'});}
});

app.get('/api/ai/chart-analysis',optionalAuth,aiLimit,async(req,res)=>{
  const pair=String(req.query.symbol||'BTCUSDT').toUpperCase(),tf=String(req.query.tf||'1h');
  if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});
  if(!symbols[pair])await refreshMarketUniverse();
  if(!symbols[pair])return res.status(400).json({error:'unsupported_market'});
  try{const language=(()=>{const x=String(req.query?.language||readCookie(req,'cp_language')||'en').toLowerCase();return x==='fa'||x==='ru'?x:'en';})();res.json({ok:true,...await buildChartAiAnalysis(pair,tf,language)});}
  catch{res.status(503).json({error:'chart_ai_unavailable'});}
});

app.post('/api/ai/analyze',auth,aiLimit,premium,async(req,res)=>{if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'ai_not_configured'});const symbol=String(req.body?.symbol||''),context=String(req.body?.context||'').slice(0,12000);try{const r=await fetch('https://1xai.ir/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',messages:[{role:'user',content:`You are CryptoPilot AI's educational crypto market analyst. Analyze only the supplied market data. Explain trend, momentum, volatility, volume, support/resistance and risks. Never guarantee returns. Do not present certainty or personalized financial advice. Symbol: ${symbol}. Data: ${context}`}]}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('ai');const j=await r.json();res.json({answer:j.output_text||'No analysis returned.'});}catch{res.status(503).json({error:'ai_unavailable'});}});

// Large-trade activity: exchange trade-flow data, refreshed independently from technical candles.
const whaleCache=new Map();
app.get('/api/whales',optionalAuth,apiLimit,async(req,res)=>{
  const pair=String(req.query.symbol||'BTCUSDT').toUpperCase();
  if(!/^[A-Z0-9]{2,20}USDT$/.test(pair))return res.status(400).json({error:'unsupported_market'});
  const cached=whaleCache.get(pair);
  if(cached&&Date.now()-cached.t<15000)return res.json(cached.v);

  // Always try the live exchange trade feed FIRST. Never let an existing candle
  // snapshot hide real whale/trade-flow data.
  try{
    const urls=[
      'https://data-api.binance.vision/api/v3/aggTrades?symbol='+encodeURIComponent(pair)+'&limit=1000',
      'https://api.binance.com/api/v3/aggTrades?symbol='+encodeURIComponent(pair)+'&limit=1000'
    ];
    let rows=null;
    for(const u of urls){
      try{
        const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
        if(r.ok){
          const data=await r.json();
          if(Array.isArray(data)&&data.length){rows=data;break;}
        }
      }catch{}
    }
    if(!Array.isArray(rows)||!rows.length)throw Error('binance_trade_feed');

    const trades=rows.map(x=>{
      const price=Number(x.p),qty=Number(x.q),notional=price*qty;
      return {time:new Date(Number(x.T)).toISOString(),price,quantity:qty,notional,side:x.m?'SELL':'BUY'};
    }).filter(x=>Number.isFinite(x.notional)&&x.notional>0);
    const sorted=[...trades].sort((a,b)=>b.notional-a.notional);
    // Dynamic threshold: top 5% of the returned trades, with a sensible floor.
    const threshold=Math.max(100000,sorted[Math.min(49,sorted.length-1)]?.notional||100000);
    const large=sorted.filter(x=>x.notional>=threshold).slice(0,20).sort((a,b)=>a.time.localeCompare(b.time));
    const buy=large.filter(x=>x.side==='BUY').reduce((n,x)=>n+x.notional,0);
    const sell=large.filter(x=>x.side==='SELL').reduce((n,x)=>n+x.notional,0);
    const net=buy-sell,total=buy+sell;
    const view={
      ok:true,symbol:pair,asOf:new Date().toISOString(),
      window:'latest 1000 exchange aggregate trades',threshold,
      largeTrades:large,buyNotional:buy,sellNotional:sell,netNotional:net,
      bias:total&&Math.abs(net)/total<.1?'mixed':net>0?'large-buy flow':'large-sell flow',
      provider:'Binance aggregate trade feed',fallback:false,
      disclaimer:'These are large exchange trade flows, not proof of specific whale identities or on-chain wallet movements.'
    };
    whaleCache.set(pair,{t:Date.now(),v:view});
    return res.json(view);
  }catch{
    // Technical snapshot is a clearly labelled fallback only when direct trade
    // data cannot be reached; it must never be presented as whale activity.
    try{
      const cachedAnalysis=cache.get(pair+'1h')?.v;
      const j=cachedAnalysis||await Promise.race([
        getAnalysis(pair,'1h'),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('fallback_timeout')),5000))
      ]);
      const a=j?.analysis||{};
      const bull=Number(a.bullScore||0),bear=Number(a.bearScore||0);
      const fallbackBias=Math.abs(bull-bear)<10?'mixed':bull>bear?'large-buy flow':'large-sell flow';
      const view={
        ok:true,symbol:pair,asOf:new Date().toISOString(),
        window:'latest live market snapshot',threshold:null,largeTrades:[],
        buyNotional:null,sellNotional:null,netNotional:null,bias:fallbackBias,
        provider:'technical-fallback',fallback:true,
        disclaimer:'Direct large-trade data was unavailable. This technical snapshot is not whale activity and is not proof of wallet movements.'
      };
      whaleCache.set(pair,{t:Date.now(),v:view});
      return res.json(view);
    }catch{
      return res.status(503).json({error:'whale_activity_unavailable'});
    }
  }
});
app.get('/api/screenshot-assets',optionalAuth,apiLimit,async(req,res)=>{
  try{
    const universe=cache.get('__universe')?.v;
    if(Array.isArray(universe)&&universe.length>=100){
      const out=universe.map(x=>({symbol:String(x.symbol||'').toUpperCase(),name:String(x.name||x.symbol||''),pair:x.pair}));
      return res.json({ok:true,updatedAt:new Date().toISOString(),coins:out});
    }
    const key='__screenshot_assets';
    const cached=cache.get(key);
    if(cached&&Date.now()-cached.t<10*60*1000)return res.json({ok:true,updatedAt:new Date(cached.t).toISOString(),coins:cached.v});
    const coins=[];
    for(const page of [1,2]){
      const u='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false';
      const r=await marketFetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
      if(!r.ok)throw Error('coingecko_assets');
      const data=await r.json();
      if(!Array.isArray(data))throw Error('coingecko_assets');
      coins.push(...data);
    }
    const out=coins.slice(0,500).map(x=>({symbol:String(x.symbol||'').toUpperCase(),name:String(x.name||x.symbol||'') ,pair:String(x.symbol||'').toUpperCase()+'USDT'})).filter(x=>/^[A-Z0-9]{2,20}$/.test(x.symbol));
    if(out.length<100)throw Error('insufficient_assets');
    cache.set(key,{t:Date.now(),v:out});
    res.json({ok:true,updatedAt:new Date().toISOString(),coins:out});
  }catch{
    try{
      const all=await refreshMarketUniverse();
      const out=all.map(x=>({symbol:String(x.symbol||'').toUpperCase(),name:String(x.name||x.symbol||''),pair:x.pair}));
      if(out.length)return res.json({ok:true,updatedAt:new Date().toISOString(),coins:out});
    }catch{}
    res.status(503).json({error:'screenshot_assets_unavailable'});
  }
});

app.post('/api/ai/screenshot',auth,aiLimit,premium,async(req,res)=>{
  const symbol=String(req.body?.symbol||'BTCUSDT').toUpperCase();
  const image=String(req.body?.image||'');
  const language=(()=>{const x=String(req.body?.language||readCookie(req,'cp_language')||'fa').toLowerCase();return x==='en'||x==='ru'?x:'fa';})();
  if(!/^[A-Z0-9]{2,20}USDT$/.test(symbol))return res.status(400).json({error:'unsupported_market'});
  if(!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return res.status(400).json({error:'invalid_image'});
  if(image.length>11000000)return res.status(413).json({error:'image_too_large'});
  try{
    const market=await buildChartAiAnalysis(symbol,'1h').catch(()=>null);
    if(!process.env.OPENAI_API_KEY)throw Error('not_configured');
    const prompt=(language==='en' ? 'You are CryptoPilot AI, a professional visual crypto-chart analyst. Inspect the ACTUAL uploaded screenshot carefully. Identify only features you can see: price structure, trend, swing highs/lows, support/resistance, breakouts/breakdowns, volume, momentum indicators, moving averages, RSI/MACD if visible, and warning signs. Use the supplied live market context only as secondary context; never replace visual evidence with guesses. Return VALID JSON ONLY with keys summary, points, bullishScenario, bearishScenario, watch. Use 3 to 6 points when the screenshot supports them. x/y are percentages from the left/top of the image and MUST point to the actual relevant location in the uploaded image. Do not invent unreadable numbers. Write clear, fluent English. Explain each point in practical language for a normal user. Never guarantee profit or give personalized financial advice. LIVE CONTEXT: ' : 'You are CryptoPilot AI, a professional visual crypto-chart analyst. Inspect the ACTUAL uploaded screenshot carefully. Identify only features you can see and return VALID JSON ONLY with keys summary, points, bullishScenario, bearishScenario, watch. Write clear, fluent Persian and never guarantee profit or give personalized financial advice. LIVE CONTEXT: ') + JSON.stringify(market||{symbol});
    const models=[process.env.OPENAI_VISION_MODEL||'gpt-4o', 'gpt-4o'].filter((x,i,a)=>x&&!a.slice(0,i).includes(x));
    let raw='';
    for(const model of models){
      try{
        const rr=await fetch('https://1xai.ir/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model,temperature:0.2,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:image}}]}]}),signal:AbortSignal.timeout(30000)});
        if(!rr.ok)continue;
        const j=await rr.json();
        const c=j.choices?.[0]?.message?.content;
        raw=Array.isArray(c)?c.map(x=>typeof x==='string'?x:x?.text||'').join('\n'):String(c||'');
        if(raw.trim())break;
      }catch{}
    }
    if(!raw.trim())throw Error('vision');
    const cleaned=raw.replace(/^\s*\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`\s*$/,'').trim();
    let analysis;try{analysis=JSON.parse(cleaned)}catch{throw Error('invalid_vision_json');}
    if(!analysis||typeof analysis!=='object')throw Error('invalid_vision_json');
    if(!Array.isArray(analysis.points))analysis.points=[];
    analysis.points=analysis.points.slice(0,6).map((p,i)=>({id:i+1,x:Math.max(0,Math.min(100,Number(p.x)||50)),y:Math.max(0,Math.min(100,Number(p.y)||50)),title:String(p.title||(language==='en'?'Important chart point':'نقطه مهم روی چارت')),explanation:String(p.explanation||''),lesson:String(p.lesson||''),type:String(p.type||'trend')}));
    if(!String(analysis.summary||'').trim()&&!analysis.points.length)throw Error('empty_vision');
    res.json({ok:true,source:'1xai',model:models[0],symbol,asOf:new Date().toISOString(),analysis});
  }catch(e){
    res.status(503).json({error:'screenshot_ai_unavailable',detail:String(e?.message||'vision_failed')});
  }
});

let dailyPickCache={t:0,data:null,running:false};

function analysisPairsSeed(){
  return ['BTC','ETH','SOL','BNB','XRP'].map((symbol,i)=>({symbol,pair:symbol+'USDT',name:symbol,change24h:0,price:null,marketCapRank:i+1}));
}

function utcDateKey(d=new Date()){return d.toISOString().slice(0,10);}
async function getCurrentPrice(symbol){
  try{
    const pair=symbol+'USDT';
    const j=await getAnalysis(pair,'1h');
    return Number(j.analysis?.price);
  }catch{return null;}
}
async function recordDailyPickRun(picks){
  const runDate=utcDateKey(new Date());
  let run=db.prepare('SELECT id FROM daily_pick_runs WHERE run_date=?').get(runDate);
  if(!run){
    const tx=db.transaction(items=>{
      const r=db.prepare('INSERT INTO daily_pick_runs(run_date) VALUES(?)').run(runDate);
      for(const x of items){
        if(Number.isFinite(Number(x.price))) db.prepare('INSERT INTO daily_pick_items(run_id,symbol,rank,entry_price,score,confidence) VALUES(?,?,?,?,?,?)').run(r.lastInsertRowid,x.symbol,x.rank,x.price,x.score,x.confidence);
      }
      return r.lastInsertRowid;
    });
    run={id:tx(picks)};
  }
  return run.id;
}

function recordDailyPickSnapshots(runId,picks){
  if(!runId||!Array.isArray(picks)||!picks.length)return;
  const items=db.prepare('SELECT id,symbol FROM daily_pick_items WHERE run_id=?').all(runId);
  const by=new Map(items.map(x=>[x.symbol,x.id]));
  const insert=db.prepare('INSERT INTO daily_pick_snapshots(run_id,item_id,symbol,price,recorded_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)');
  const tx=db.transaction(rows=>{
    for(const x of rows){
      const itemId=by.get(x.symbol),price=Number(x.price);
      if(itemId&&Number.isFinite(price)&&price>0)insert.run(runId,itemId,x.symbol,price);
    }
  });
  tx(picks);
}

async function evaluateDailyPickRun(run){
  if(!run?.id)return;
  const targetMs=Date.parse(String(run.created_at||''));
  if(!Number.isFinite(targetMs)||Date.now()<targetMs+24*60*60*1000)return;
  const items=db.prepare('SELECT id,symbol,entry_price FROM daily_pick_items WHERE run_id=? ORDER BY rank').all(run.id);
  const insert=db.prepare('INSERT OR IGNORE INTO daily_pick_results(run_id,item_id,symbol,target_at,entry_price,exit_price,change_pct,source) VALUES(?,?,?,?,?,?,?,?)');
  for(const item of items){
    const exists=db.prepare('SELECT id FROM daily_pick_results WHERE run_id=? AND item_id=?').get(run.id,item.id);
    if(exists)continue;
    const targetAt=new Date(targetMs+24*60*60*1000).toISOString();
    const snap=db.prepare("SELECT price,recorded_at FROM daily_pick_snapshots WHERE run_id=? AND item_id=? ORDER BY ABS(strftime('%s',recorded_at)-strftime('%s',?)) ASC LIMIT 1").get(run.id,item.id,targetAt);
    let exitPrice=Number(snap?.price),source='24h_snapshot';
    if(!Number.isFinite(exitPrice)||exitPrice<=0){
      exitPrice=await getCurrentPrice(item.symbol);
      source='post_24h_live_fallback';
    }
    if(!Number.isFinite(exitPrice)||exitPrice<=0||!Number(item.entry_price))continue;
    const change=((exitPrice-Number(item.entry_price))/Number(item.entry_price))*100;
    insert.run(run.id,item.id,item.symbol,targetAt,Number(item.entry_price),exitPrice,change,source);
  }
}

async function getDailyPerformance(daysAgo=1){
  const safeDays=Math.max(1,Math.min(30,Number(daysAgo)||1));
  const target=new Date(Date.now()-safeDays*86400000);
  const date=utcDateKey(target);
  const run=db.prepare('SELECT id,run_date,created_at FROM daily_pick_runs WHERE run_date=?').get(date);
  if(!run)return {available:false,date,reason:'history_not_collected'};
  await evaluateDailyPickRun(run);
  const items=db.prepare('SELECT symbol,rank,entry_price,score,confidence FROM daily_pick_items WHERE run_id=? ORDER BY rank').all(run.id);
  const results=db.prepare('SELECT symbol,rank,entry_price,exit_price,change_pct,source,evaluated_at,target_at FROM daily_pick_results r JOIN daily_pick_items i ON i.id=r.item_id WHERE r.run_id=? ORDER BY rank').all(run.id);
  if(results.length<items.length){
    const age=Date.now()-Date.parse(String(run.created_at||''));
    return {available:false,date,reason:age<24*60*60*1000?'history_not_ready':'history_incomplete',trackedCount:results.length,totalCount:items.length,targetAt:new Date(Date.parse(String(run.created_at||''))+24*60*60*1000).toISOString()};
  }
  const valid=results.filter(x=>Number.isFinite(Number(x.change_pct)));
  const avg=valid.length?valid.reduce((a,x)=>a+Number(x.change_pct),0)/valid.length:null;
  const positive=valid.filter(x=>Number(x.change_pct)>0).length;
  const negative=valid.filter(x=>Number(x.change_pct)<0).length;
  const best=valid.length?Math.max(...valid.map(x=>Number(x.change_pct))):null;
  const worst=valid.length?Math.min(...valid.map(x=>Number(x.change_pct))):null;
  return {available:true,date,runCreatedAt:run.created_at,targetAt:new Date(Date.parse(String(run.created_at))+24*60*60*1000).toISOString(),picks:valid,averageReturn:avg,positiveCount:positive,negativeCount:negative,totalCount:valid.length,bestChange:best,worstChange:worst,method:'Equal-weight 24-hour price change from the recorded pick entry. The exit price uses the closest recorded market snapshot to the 24-hour target; if no snapshot exists, a clearly marked live fallback is used. Fees, slippage and execution costs are excluded.'};
}

async function computeDailyPicks(){
  if(dailyPickCache.running)return dailyPickCache.data;
  dailyPickCache.running=true;
  try{
    // Seed from the already-persisted universe before the first await. This makes
    // the HTTP endpoint immediately usable even during a complete provider outage.
    const cachedUniverse=[...(cache.get('__universe')?.v||[])].filter(x=>x&&x.symbol&&Number.isFinite(Number(x.change24h)));
    const seedUniverse=cachedUniverse.length?cachedUniverse:analysisPairsSeed();
    const seed=[...seedUniverse].sort((a,b)=>Number(b.change24h||0)-Number(a.change24h||0)).slice(0,5).map((x,i)=>({symbol:String(x.symbol).toUpperCase(),pair:x.pair||String(x.symbol).toUpperCase()+'USDT',price:Number.isFinite(Number(x.price))?Number(x.price):null,rank:i+1,score:Math.round(Math.max(50,Math.min(99,50+Math.max(0,Number(x.change24h||0))*2))),confidence:'live-growth',signals:[{tf:'24h',setup:'TOP GROWTH',bull:null,bear:null,rsi:null,volumeRatio:null}]}));
    if(seed.length>=5){
      dailyPickCache={t:Date.now(),data:{ok:true,updatedAt:new Date().toISOString(),picks:seed,performance:{available:false,reason:'analysis_refreshing'},disclaimer:'Research-only signals. No pump or profit is guaranteed.'},running:true};
    }
    await refreshMarketUniverse();
    const tfs=['15m','1h','4h']; const by=new Map();
    // Keep the scheduled pick calculation bounded to the core liquid pairs.
    // The market universe can contain 500 assets, but analyzing all of them here
    // makes a cold-start request wait on hundreds of external calls.
    const analysisPairs=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
    // Seed immediately from the live universe so the endpoint can never be held
    // hostage by a slow external technical-analysis provider.
    const universeNow=[...(cache.get('__universe')?.v||[])].filter(x=>x&&x.symbol&&Number.isFinite(Number(x.change24h)));
    await Promise.all(tfs.map(async tf=>{
      const batch=analysisPairs;
      await Promise.all(batch.map(async pair=>{
        try{
          const j=await getAnalysis(pair,tf),a=j.analysis;if(!a||!Number.isFinite(a.price))return;
          const old=by.get(j.symbol)||{symbol:j.symbol,pair,price:a.price,score:0,tfCount:0,signals:[]};
          const directional=Math.max(Number(a.bullScore||0),Number(a.bearScore||0));
          const momentum=Math.max(-1,Math.min(1,Number(a.momentum||0)));
          const volume=Math.max(0,Math.min(2,Number(a.volumeRatio||0)-1));
          const trend=(Number(a.ema20||0)>Number(a.ema50||0)?1:-1)+(Number(a.ema50||0)>Number(a.ema200||0)?1:-1);
          old.score+=(directional*.55)+(Math.max(0,momentum)*18)+(volume*8)+(trend*4);
          old.tfCount++;old.price=a.price;
          old.signals.push({tf,bull:a.bullScore,bear:a.bearScore,rsi:a.rsi,volumeRatio:a.volumeRatio,setup:a.setup});
          by.set(j.symbol,old);
        }catch{}
      }));
    }));
    const analyzed=[...by.values()].filter(x=>x.tfCount>=2).sort((a,b)=>b.score-a.score).slice(0,5).map((x,i)=>({...x,rank:i+1,score:Math.round(Math.min(99,x.score/x.tfCount)),confidence:x.tfCount>=3?'multi-timeframe':'multi-signal'}));
    const picks=analyzed.length?analyzed.slice(0,5):[];
    for(const x of seed){if(picks.length>=5)break;if(!picks.some(p=>p.symbol===x.symbol))picks.push({...x,rank:picks.length+1});}
    // If analysis produced fewer than five, fill from the live universe while
    // preserving any analyzed picks already selected.
    const existing=new Set(picks.map(x=>x.symbol));
    // Always keep the Daily AI Picks panel populated with exactly five candidates.
    // If multi-timeframe analysis is temporarily rate-limited/unavailable, fall back
    // to the live market universe's strongest 24h movers rather than returning zero picks.
    if(picks.length<5){
      const fallback=[...(cache.get('__universe')?.v||[])]
        .filter(x=>x&&x.symbol&&!existing.has(x.symbol)&&Number.isFinite(Number(x.change24h)))
        .sort((a,b)=>Number(b.change24h)-Number(a.change24h))
        .slice(0,5-picks.length)
        .map((x,i)=>({
          symbol:String(x.symbol).toUpperCase(),
          pair:x.pair||String(x.symbol).toUpperCase()+'USDT',
          price:Number(x.price)||null,
          rank:picks.length+i+1,
          score:Math.round(Math.max(50,Math.min(99,50+Math.max(0,Number(x.change24h))*2))),
          confidence:'live-growth',
          signals:[{tf:'24h',setup:'TOP GROWTH',bull:x.bullScore,bear:x.bearScore,rsi:x.rsi,volumeRatio:x.volumeRatio}]
        }));
      picks.push(...fallback);
    }
    const runId=await recordDailyPickRun(picks);
    recordDailyPickSnapshots(runId,picks);
    const performance=await getDailyPerformance(1);
    dailyPickCache={t:Date.now(),data:{ok:true,updatedAt:new Date().toISOString(),picks,performance,disclaimer:'Research-only signals. No pump or profit is guaranteed.'},running:false};
    return dailyPickCache.data;
  }catch{
    dailyPickCache.running=false;
    return dailyPickCache.data;
  }
}

app.get('/api/daily-picks',optionalAuth,async(req,res)=>{
  const fresh=dailyPickCache.data&&Date.now()-dailyPickCache.t<5*60*1000;
  if(!fresh && !dailyPickCache.running)computeDailyPicks().catch(()=>{});
  if(!dailyPickCache.data)return res.status(503).json({error:'daily_picks_unavailable'});
  const d=dailyPickCache.data;
  const isPremium=req.user?.plan==='premium';
  res.json({
    ok:true,updatedAt:d.updatedAt,
    premium:isPremium,
    picks:isPremium?d.picks:d.picks.map(x=>({rank:x.rank,confidence:x.confidence,score:x.score,locked:true})),
    performance:isPremium?d.performance:{available:false,reason:'premium_required'},
    disclaimer:d.disclaimer
  });
});
app.get('/api/daily-picks/history',auth,premium,async(req,res)=>{
  try{res.json({ok:true,performance:await getDailyPerformance(Number(req.query.daysAgo||1))});}
  catch{res.status(503).json({error:'daily_pick_history_unavailable'});}
});
setTimeout(()=>computeDailyPicks().catch(()=>{}),5000);
setInterval(()=>computeDailyPicks().catch(()=>{}),5*60*1000);
app.get('/api/admin/overview',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'forbidden'});res.json({users:db.prepare('SELECT COUNT(*) c FROM users').get().c,premium:db.prepare("SELECT COUNT(*) c FROM users WHERE plan='premium'").get().c,alerts:db.prepare('SELECT COUNT(*) c FROM alerts WHERE active=1').get().c,payments:db.prepare('SELECT COUNT(*) c FROM payments').get().c});});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'internal_error'});});
app.listen(port,'0.0.0.0',()=>console.log(`CryptoPilot AI 2.7.0 listening on ${port}`));