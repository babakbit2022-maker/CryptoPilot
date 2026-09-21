import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

// CryptoPilot AI technical release. Full release archive is maintained in project Library.
const app = express();
const port = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) console.warn('WARNING: JWT_SECRET must be a random 32+ character secret in production.');
const db = new Database(process.env.DB_PATH || 'cryptopilot.db');
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,plan TEXT NOT NULL DEFAULT 'free',role TEXT NOT NULL DEFAULT 'user',email_verified INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,symbol TEXT NOT NULL,target REAL NOT NULL,direction TEXT NOT NULL DEFAULT 'above',active INTEGER NOT NULL DEFAULT 1,triggered_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,event_id TEXT UNIQUE,provider TEXT,status TEXT,amount INTEGER,currency TEXT,authority TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,meta TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_predictions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,symbol TEXT NOT NULL,tf TEXT NOT NULL,bias TEXT NOT NULL,entry REAL,stop REAL,tp1 REAL,tp2 REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,status TEXT NOT NULL DEFAULT 'pending',outcome TEXT,source TEXT DEFAULT 'live',FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_market ON ai_predictions(symbol,tf,created_at);
CREATE TABLE IF NOT EXISTS daily_pick_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,run_date TEXT UNIQUE NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS daily_pick_items(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,symbol TEXT NOT NULL,rank INTEGER NOT NULL,entry_price REAL NOT NULL,score REAL,confidence TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(run_id) REFERENCES daily_pick_runs(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_daily_pick_items_run ON daily_pick_items(run_id,rank);
`);
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public', { extensions: ['html'] }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimit = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const aiLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimit);
function sign(u) { return jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '2h' }); }
function sessionCookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}
function setSession(res, u) {
  // Do not depend on cookie-parser/express-session; keep auth self-contained.
  res.setHeader('Set-Cookie', `cp_session=${encodeURIComponent(sign(u))}; ${sessionCookieOptions(2 * 60 * 60 * 1000)}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `cp_session=; ${sessionCookieOptions(0)}`);
}
function readCookie(req, name) { const h = req.headers.cookie || ''; const m = h.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
function optionalAuth(req,res,next){try{const bearer=String(req.headers.authorization||'');const raw=bearer.startsWith('Bearer ')?bearer.slice(7):readCookie(req,'cp_session');if(!raw||!JWT_SECRET){req.user=null;return next();}const p=jwt.verify(raw,JWT_SECRET);req.user=db.prepare('SELECT id,email,plan,role,email_verified FROM users WHERE id=?').get(p.id)||null;}catch{req.user=null;}next();}
function auth(req, res, next) { try { if (!JWT_SECRET) throw new Error(); const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''; const raw = bearer || readCookie(req, 'cp_session'); if (!raw) throw new Error(); req.user = jwt.verify(raw, JWT_SECRET); const u = db.prepare('SELECT id,email,plan,role,email_verified FROM users WHERE id=?').get(req.user.id); if (!u) throw new Error(); req.user = u; next(); } catch { res.status(401).json({ error: 'unauthorized' }); } }
function premium(req,res,next){ if(req.user.plan!=='premium') return res.status(403).json({error:'premium_required'}); next(); }
function audit(userId, action, meta={}) { db.prepare('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)').run(userId || null, action, JSON.stringify(meta)); }
function aiMemoryBias(a){if(!a)return 'NEUTRAL';if(a.setup==='BULLISH_SETUP')return 'LONG';if(a.setup==='BEARISH_SETUP')return 'SHORT';return Number(a.bullScore||0)>Number(a.bearScore||0)?'LONG':Number(a.bearScore||0)>Number(a.bullScore||0)?'SHORT':'NEUTRAL';}
function aiMemoryEvaluate(rows,currentPrice){for(const p of rows){if(p.status!=='pending')continue;const px=Number(currentPrice);const entry=Number(p.entry),stop=Number(p.stop),tp1=Number(p.tp1);if(!Number.isFinite(px)||!Number.isFinite(entry)||!Number.isFinite(stop)||!Number.isFinite(tp1))continue;let outcome=null;if(p.bias==='LONG'){if(px>=tp1)outcome='TP1_HIT';else if(px<=stop)outcome='STOP_HIT';}else if(p.bias==='SHORT'){if(px<=tp1)outcome='TP1_HIT';else if(px>=stop)outcome='STOP_HIT';}if(outcome){db.prepare("UPDATE ai_predictions SET status='resolved',outcome=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(outcome,p.id);}}}
function aiMemorySummary(symbol,tf){const rows=db.prepare("SELECT * FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);const resolved=rows.filter(x=>x.status==='resolved');const wins=resolved.filter(x=>x.outcome==='TP1_HIT').length;return {total:rows.length,resolved:resolved.length,wins,accuracy:resolved.length?Math.round(wins/resolved.length*100):null,pending:rows.length-resolved.length,last:rows[0]||null};}
app.get('/api/health', (req,res)=>res.status(200).json({ok:true,service:'CryptoPilot AI',version:'2.7-technical',time:new Date().toISOString()}));
app.get('/api/ready', (req,res)=>res.status(200).json({ok:true,ready:true,version:'2.7.0'}));
app.post('/api/auth/register', authLimit, async (req,res)=>{ const email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password; if(!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<8)return res.status(400).json({error:'invalid_credentials'}); try{const hash=await bcrypt.hash(password,12);const r=db.prepare('INSERT INTO users(email,password) VALUES(?,?)').run(email,hash);const u=db.prepare('SELECT id,email,plan,role FROM users WHERE id=?').get(r.lastInsertRowid);setSession(res,u);audit(u.id,'register');res.json({user:u});}catch{res.status(409).json({error:'email_exists'});}});
app.post('/api/auth/login', authLimit, async (req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!(await bcrypt.compare(password,u.password)))return res.status(401).json({error:'invalid_login'});setSession(res,u);audit(u.id,'login');res.json({user:{id:u.id,email:u.email,plan:u.plan,role:u.role}});});
app.post('/api/auth/logout',(req,res)=>{clearSession(res);res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
const symbols={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA',AVAXUSDT:'AVAX',LINKUSDT:'LINK',DOTUSDT:'DOT',LTCUSDT:'LTC',TRXUSDT:'TRX'};
const symbolMeta=new Map(Object.entries(symbols).map(([pair,symbol])=>[pair,{symbol,coingeckoId:null}]));
const tfMap={'1m':1,'15m':15,'1h':60,'4h':240,'1d':1440};
const cache=new Map();
async function refreshMarketUniverse(){
  const now=Date.now();
  const cached=cache.get('__universe');
  if(cached&&now-cached.t<3*60*1000)return cached.v;
  try{
    const cgPages=await Promise.all([1,2].map(async page=>{const r=await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false&price_change_percentage=24h',{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('coingecko universe');return r.json();}));
    const cg={ok:true,json:async()=>cgPages.flat()};
    if(!cg.ok)throw new Error('coingecko universe');
    const market=(await cg.json()).slice(0,500);
    const binanceUrls=['https://data-api.binance.vision/api/v3/exchangeInfo','https://api-gcp.binance.com/api/v3/exchangeInfo','https://api.binance.com/api/v3/exchangeInfo','https://api1.binance.com/api/v3/exchangeInfo','https://api2.binance.com/api/v3/exchangeInfo','https://api3.binance.com/api/v3/exchangeInfo','https://api4.binance.com/api/v3/exchangeInfo'];
    let info=null;
    for(const u of binanceUrls){try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});if(r.ok){info=await r.json();break;}}catch{}}
    const tradable=new Set((info?.symbols||[]).filter(x=>x.status==='TRADING'&&x.quoteAsset==='USDT'&&x.isSpotTradingAllowed!==false).map(x=>x.symbol));
    const seen=new Set();
    const v=[];
    for(const c of market){
      const symbol=String(c.symbol||'').toUpperCase();
      const pair=symbol+'USDT';
      if(seen.has(pair))continue;
      seen.add(pair);
      // Register every CoinGecko asset so the dashboard can open its market endpoint.
      // Chart availability is resolved on-demand through Binance market-data fallbacks.
      symbols[pair]=symbol;
      symbolMeta.set(pair,{symbol,coingeckoId:c.id,marketCap:c.market_cap||0,marketCapRank:c.market_cap_rank||null,name:c.name||symbol,image:c.image||null});
      const chartable=tradable.size ? tradable.has(pair) : true;
      v.push({pair,symbol,name:c.name||symbol,marketCap:c.market_cap||0,marketCapRank:c.market_cap_rank||null,image:c.image||null,change24h:c.price_change_percentage_24h??null,price:c.current_price??null,volume24h:c.total_volume??null,chartable});
    }
    // Keep the top-500 CoinGecko market-cap universe; only live Binance USDT pairs are chartable.
    cache.set('__universe',{t:now,v});
    return v;
  }catch{
    const fallback=Object.entries(symbols).map(([pair,symbol])=>({pair,symbol,name:symbol}));
    cache.set('__universe',{t:now,v:fallback});
    return fallback;
  }
}

async function binanceKlines(symbol,interval,limit=250){const configured=(process.env.MARKET_BASE_URL||'').replace(/\/$/,'');const bases=[configured,'https://data-api.binance.vision','https://api-gcp.binance.com','https://api.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'].filter((v,i,a)=>v&&!a.slice(0,i).includes(v));let last=null;for(const base of bases){try{const u=`${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(r.ok){const data=await r.json();if(Array.isArray(data)&&data.length)return data;}last=new Error('binance');}catch(e){last=e;}}throw last||new Error('binance');}
function providerInterval(tf){return {'1m':60,'15m':900,'1h':3600,'4h':21600,'1d':86400}[tf]||900;}
async function coinbaseKlines(symbol,tf,limit=250){const base=symbol.replace(/USDT$/,'')+'-USD';const g=providerInterval(tf);const end=Math.floor(Date.now()/1000),start=end-g*limit;const u=`https://api.exchange.coinbase.com/products/${encodeURIComponent(base)}/candles?granularity=${g}&start=${new Date(start*1000).toISOString()}&end=${new Date(end*1000).toISOString()}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('coinbase');const data=await r.json();if(!Array.isArray(data)||!data.length)throw new Error('coinbase');return data.reverse().map(x=>[Number(x[0])*1000,Number(x[3]),Number(x[2]),Number(x[1]),Number(x[4]),Number(x[5])]);}
async function krakenKlines(symbol,tf,limit=250){const map={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD',AVAXUSDT:'AVAXUSD',LINKUSDT:'LINKUSD',DOTUSDT:'DOTUSD',LTCUSDT:'LTCUSD',TRXUSDT:'TRXUSD'};const pair=map[symbol]||symbol.replace(/USDT$/,'')+'USD';const interval={'1m':1,'15m':15,'1h':60,'4h':240,'1d':1440}[tf]||15;const u=`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('kraken');const j=await r.json();const key=Object.keys(j.result||{}).find(k=>k!=='last');const data=key?j.result[key]:[];if(!data.length)throw new Error('kraken');return data.slice(-limit).map(x=>[Number(x[0])*1000,Number(x[1]),Number(x[2]),Number(x[3]),Number(x[4]),Number(x[6])]);}
function ema(a,n){if(a.length<n)return null;const k=2/(n+1);let e=a.slice(0,n).reduce((s,v)=>s+v,0)/n;for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function rsi(a,n=14){if(a.length<=n)return null;let g=0,l=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}let ag=g/n,al=l/n;for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(n-1)+(d>0?d:0))/n;al=(al*(n-1)+(d<0?-d:0))/n;}return al===0?100:100-100/(1+ag/al);}
function atr(rows,n=14){if(rows.length<=n)return null;const trs=[];for(let i=1;i<rows.length;i++){const h=rows[i].h,l=rows[i].l,pc=rows[i-1].c;trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}return trs.slice(-n).reduce((s,v)=>s+v,0)/Math.min(n,trs.length);}
function analyze(rows){const closes=rows.map(x=>x.c),vols=rows.map(x=>x.v),cur=closes.at(-1),e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),r=rsi(closes),a=atr(rows);const mom=closes.length>28?cur/closes.at(-29)-1:cur/closes[0]-1,avgVol=vols.slice(-20).reduce((s,v)=>s+v,0)/Math.min(20,vols.length),vr=avgVol?vols.at(-1)/avgVol:0;const recent=rows.slice(-50),support=Math.min(...recent.map(x=>x.l)),resistance=Math.max(...recent.map(x=>x.h));let bull=0;if(e20&&cur>e20)bull+=16;if(e50&&cur>e50)bull+=14;if(e200&&cur>e200)bull+=12;if(r>=50&&r<=68)bull+=16;else if(r>68&&r<75)bull+=8;else if(r<35)bull+=3;if(mom>0)bull+=16;if(vr>=1.2)bull+=10;if(cur>support*1.01)bull+=4;bull=Math.max(0,Math.min(100,Math.round(bull)));let bear=100-bull;let risk=30;if(a)risk+=Math.min(32,(a/cur)*100*6);if(r>75||r<25)risk+=12;if(vr>2)risk+=8;risk=Math.max(5,Math.min(95,Math.round(risk)));let setup='NEUTRAL';if(bull>=72&&risk<70)setup='BULLISH_SETUP';else if(bear>=72&&risk<70)setup='BEARISH_SETUP';const long={entry:cur,stop:a?cur-a*1.5:null,tp1:a?cur+a*1.5:null,tp2:a?cur+a*3:null};const short={entry:cur,stop:a?cur+a*1.5:null,tp1:a?cur-a*1.5:null,tp2:a?cur-a*3:null};return{price:cur,rsi:r,ema20:e20,ema50:e50,ema200:e200,atr:a,momentum:mom,volumeRatio:vr,support,resistance,bullScore:bull,bearScore:bear,riskScore:risk,setup,tradeLevels:{long,short}};}
async function geckoSnapshot(symbol){const ids={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',XRP:'ripple',DOGE:'dogecoin',ADA:'cardano',AVAX:'avalanche-2',LINK:'chainlink',DOT:'polkadot',LTC:'litecoin',TRX:'tron'};const id=ids[symbol];if(!id)throw new Error('gecko');const u=`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('gecko');const d=(await r.json())[id];if(!d?.usd)throw new Error('gecko');return{price:d.usd,change24h:d.usd_24h_change??null,volume24h:d.usd_24h_vol??null};}
async function getAnalysis(pair,tf){
  const key=pair+tf,now=Date.now(),c=cache.get(key);
  if(c&&now-c.t<1000)return c.v;
  const providers=[
    ['binance',()=>binanceKlines(pair,tf,250)],
    ['coinbase',()=>coinbaseKlines(pair,tf,250)],
    ['kraken',()=>krakenKlines(pair,tf,250)]
  ];
  for(const [provider,load] of providers){
    try{
      const raw=await load();
      const rows=raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
      if(!rows.length)throw new Error(provider+'_empty');
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
app.get('/api/market-status',async(req,res)=>{const checks=await Promise.all(['BTCUSDT','ETHUSDT'].map(async p=>{try{const j=await getAnalysis(p,'15m');return{pair:p,provider:j.provider,updatedAt:j.updatedAt,online:true};}catch{return{pair:p,online:false};}}));res.json({ok:checks.some(x=>x.online),checkedAt:new Date().toISOString(),markets:checks});});
app.get('/api/market-stats',async(req,res)=>{try{const all=await refreshMarketUniverse();const valid=all.filter(x=>Number.isFinite(Number(x.price)));const changes=valid.filter(x=>Number.isFinite(Number(x.change24h)));const gainers=changes.slice().sort((a,b)=>Number(b.change24h)-Number(a.change24h)).slice(0,5);const losers=changes.slice().sort((a,b)=>Number(a.change24h)-Number(b.change24h)).slice(0,5);const totalCap=valid.reduce((n,x)=>n+Number(x.marketCap||0),0);const avgChange=changes.reduce((n,x)=>n+Number(x.change24h),0)/(changes.length||1);res.json({ok:true,updatedAt:new Date().toISOString(),totalAssets:all.length,totalUniverse:500,pricedAssets:valid.length,totalMarketCap:totalCap,averageChange24h:avgChange,topGainers:gainers,topLosers:losers});}catch{res.status(503).json({error:'market_stats_unavailable'});}});
app.get('/api/coins',async(req,res)=>{const q=String(req.query.q||'').toLowerCase().trim();const all=await refreshMarketUniverse();const list=all.filter(x=>!q||x.symbol.toLowerCase().includes(q)||String(x.name||'').toLowerCase().includes(q));res.json({updatedAt:new Date().toISOString(),coins:list,count:list.length,totalUniverse:500,universe:'CoinGecko top 500 by market cap',sort:'market_cap_desc'});});
app.get('/api/ai/market-intelligence',async(req,res)=>{try{const symbol=String(req.query.symbol||'BTCUSDT').toUpperCase();await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});const tfs=['1m','15m','1h','4h'];const reports=await Promise.all(tfs.map(async tf=>{try{const j=await getAnalysis(symbol,tf);return {tf,provider:j.provider,updatedAt:j.updatedAt,analysis:j.analysis};}catch{return {tf,available:false};}}));const usable=reports.filter(x=>x.analysis);if(!usable.length)return res.status(503).json({error:'market_unavailable'});const bull=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.bullScore||0),0)/usable.length);const bear=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.bearScore||0),0)/usable.length);const risk=Math.round(usable.reduce((n,x)=>n+Number(x.analysis.riskScore||50),0)/usable.length);const trend=bull>=65?'Bullish':bear>=65?'Bearish':'Mixed';const alignment=usable.filter(x=>(trend==='Bullish'?Number(x.analysis.bullScore||0)>=60:trend==='Bearish'?Number(x.analysis.bearScore||0)>=60:true)).length;const latest=usable.find(x=>x.tf==='1h')?.analysis||usable[0].analysis;const reasoning=['Multi-timeframe trend: '+trend+'.','Timeframe alignment: '+alignment+'/'+usable.length+'.','Average bull score: '+bull+'/100; bear score: '+bear+'/100.','Average risk: '+risk+'/100.',latest.rsi!=null?'RSI: '+Number(latest.rsi).toFixed(1)+'.':'RSI unavailable.',latest.volumeRatio!=null?'Volume ratio: '+Number(latest.volumeRatio).toFixed(2)+'x.':'Volume data unavailable.'];res.json({ok:true,symbol,updatedAt:new Date().toISOString(),engine:'CryptoPilot Multi-Timeframe AI',trend,bullScore:bull,bearScore:bear,riskScore:risk,confidence:Math.max(bull,bear),reasoning,reports});}catch(e){res.status(503).json({error:'ai_market_unavailable'});}});

app.get('/api/market/:symbol',async(req,res)=>{const symbol=String(req.params.symbol||'').toUpperCase(),tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});try{res.json(await getAnalysis(symbol,tf));}catch{res.status(503).json({error:'market_unavailable'});}});
app.get('/api/scanner',async(req,res)=>{const tf=String(req.query.tf||'15m');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();const results=[];await Promise.all(Object.keys(symbols).slice(0,100).map(async pair=>{try{const j=await getAnalysis(pair,tf),a=j.analysis;results.push({symbol:j.symbol,pair,price:a.price,bullScore:a.bullScore,bearScore:a.bearScore,riskScore:a.riskScore,setup:a.setup,rsi:a.rsi,momentum:a.momentum,volumeRatio:a.volumeRatio,provider:j.provider});}catch{}}));results.sort((a,b)=>Math.max(b.bullScore,b.bearScore)-Math.max(a.bullScore,a.bearScore));res.json({tf,updatedAt:new Date().toISOString(),results,count:results.length});});
app.get('/robots.txt',(req,res)=>{const base=process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);});
app.get('/sitemap.xml',(req,res)=>{const base=(process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');const slugs=['bitcoin','ethereum','solana','binance-coin','xrp','dogecoin','cardano','avalanche','chainlink','polkadot','litecoin','tron'];const urls=['/','/market-analysis','/ai-crypto-chart-analysis',...slugs.map(s=>`/crypto/${s}`)];res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${base}${u}</loc><changefreq>${u==='/'?'daily':'hourly'}</changefreq><priority>${u==='/'?'1.0':'0.8'}</priority></url>`).join('')}</urlset>`);});
app.get('/whale-activity.html',(req,res)=>res.sendFile('index.html',{root:'public'}));
app.get(['/market-analysis','/ai-crypto-chart-analysis'],(req,res)=>res.sendFile('index.html',{root:'public'}));
app.get('/crypto/:slug',(req,res)=>res.sendFile('index.html',{root:'public'}));
app.post('/api/alerts',auth,(req,res)=>{const symbol=String(req.body?.symbol||'').toUpperCase(),target=Number(req.body?.target),direction=req.body?.direction==='below'?'below':'above';if(!Object.values(symbols).includes(symbol)||!Number.isFinite(target)||target<=0)return res.status(400).json({error:'invalid_alert'});const r=db.prepare('INSERT INTO alerts(user_id,symbol,target,direction) VALUES(?,?,?,?)').run(req.user.id,symbol,target,direction);audit(req.user.id,'alert_create',{symbol,target,direction});res.json({id:r.lastInsertRowid});});
app.get('/api/alerts',auth,(req,res)=>res.json(db.prepare('SELECT id,symbol,target,direction,active,triggered_at,created_at FROM alerts WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.delete('/api/alerts/:id',auth,(req,res)=>{db.prepare('DELETE FROM alerts WHERE id=? AND user_id=?').run(Number(req.params.id),req.user.id);audit(req.user.id,'alert_delete',{id:req.params.id});res.json({ok:true});});
async function checkAlerts(){const alerts=db.prepare('SELECT * FROM alerts WHERE active=1').all();for(const al of alerts){try{const pair=Object.entries(symbols).find(([,v])=>v===al.symbol)?.[0];if(!pair)continue;const j=await getAnalysis(pair,'15m');const price=j.analysis.price;const hit=al.direction==='above'?price>=al.target:price<=al.target;if(hit){db.prepare('UPDATE alerts SET active=0,triggered_at=CURRENT_TIMESTAMP WHERE id=?').run(al.id);audit(al.user_id,'alert_triggered',{symbol:al.symbol,target:al.target,price});}}catch{}}}
setInterval(()=>checkAlerts().catch(()=>{}),30000);
app.post('/api/ai/analyze',auth,aiLimit,premium,async(req,res)=>{if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'ai_not_configured'});const symbol=String(req.body?.symbol||''),context=String(req.body?.context||'').slice(0,12000);try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:`You are CryptoPilot AI's educational crypto market analyst. Analyze only the supplied market data. Explain trend, momentum, volatility, volume, support/resistance and risks. Never guarantee returns. Do not present certainty or personalized financial advice. Symbol: ${symbol}. Data: ${context}`}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('ai');const j=await r.json();res.json({answer:j.output_text||'No analysis returned.'});}catch{res.status(503).json({error:'ai_unavailable'});}});
let dailyPickCache={t:0,data:null,running:false};

function utcDateKey(d=new Date()){return d.toISOString().slice(0,10);}
async function getCurrentPrice(symbol){
  try{
    const pair=symbol+'USDT';
    const j=await getAnalysis(pair,'1h');
    return Number(j.analysis?.price);
  }catch{return null;}
}
async function recordDailyPickRun(picks){
  const runDate=utcDateKey();
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
async function getDailyPerformance(daysAgo=1){
  const target=new Date(Date.now()-daysAgo*86400000);
  const date=utcDateKey(target);
  const run=db.prepare('SELECT id,run_date,created_at FROM daily_pick_runs WHERE run_date=?').get(date);
  if(!run)return {available:false,date,reason:'history_not_collected'};
  const items=db.prepare('SELECT symbol,rank,entry_price,score,confidence FROM daily_pick_items WHERE run_id=? ORDER BY rank').all(run.id);
  const results=[];
  for(const x of items){
    const price=await getCurrentPrice(x.symbol);
    const change=Number.isFinite(price)&&Number(x.entry_price)>0 ? ((price-Number(x.entry_price))/Number(x.entry_price))*100 : null;
    results.push({...x,current_price:price,change24hSincePick:change});
  }
  const valid=results.filter(x=>Number.isFinite(x.change24hSincePick));
  const avg=valid.length?valid.reduce((a,x)=>a+x.change24hSincePick,0)/valid.length:null;
  const positive=valid.filter(x=>x.change24hSincePick>0).length;
  return {available:true,date,picks:results,averageReturn:avg,positiveCount:positive,totalCount:valid.length,method:'Equal-weight price change from recorded daily pick entry; excludes fees/slippage.'};
}

async function computeDailyPicks(){
  if(dailyPickCache.running)return dailyPickCache.data;
  dailyPickCache.running=true;
  try{
    await refreshMarketUniverse();
    const tfs=['15m','1h','4h']; const by=new Map();
    await Promise.all(tfs.map(async tf=>{
      const batch=Object.keys(symbols).slice(0,60);
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
    const picks=[...by.values()].filter(x=>x.tfCount>=2).sort((a,b)=>b.score-a.score).slice(0,5).map((x,i)=>({...x,rank:i+1,score:Math.round(Math.min(99,x.score/x.tfCount)),confidence:x.tfCount>=3?'multi-timeframe':'multi-signal'}));
    await recordDailyPickRun(picks);
    const performance=await getDailyPerformance(1);
    dailyPickCache={t:Date.now(),data:{ok:true,updatedAt:new Date().toISOString(),picks,performance,disclaimer:'Research-only signals. No pump or profit is guaranteed.'},running:false};
    return dailyPickCache.data;
  }catch{
    dailyPickCache.running=false;
    return dailyPickCache.data;
  }
}


const whaleCache={t:0,data:null,running:false};
const futuresBases=['https://fapi.binance.com','https://fapi1.binance.com','https://fapi2.binance.com','https://fapi3.binance.com','https://fapi4.binance.com'];
async function futuresJson(path){
  let last=null;
  for(const base of futuresBases){
    try{
      const r=await fetch(base+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
      if(r.ok)return await r.json();
      last=new Error('futures '+r.status);
    }catch(e){last=e}
  }
  throw last||new Error('futures unavailable');
}
function whalePct(v){return Number.isFinite(Number(v))?Number(v)*100:null}
function whaleMoney(v){const n=Number(v);if(!Number.isFinite(n))return null;return n}
function whaleNarrative(x){
  const p=Number(x.priceChange24h||0), oi=Number(x.oiChange12h||0), taker=Number(x.takerImbalance12h||0), fund=Number(x.fundingRate||0);
  if(taker>.12&&oi>2&&p>0.5)return 'خرید تهاجمی در معاملات اهرمی هم‌زمان با افزایش موقعیت‌ها دیده می‌شود؛ فعلاً فشار خرید قوی‌تر است.';
  if(taker<-.12&&oi>2&&p<-.5)return 'فروش تهاجمی هم‌زمان با افزایش موقعیت‌ها دیده می‌شود؛ فشار فروش در حال تقویت است.';
  if(p>1&&oi<-2)return 'قیمت بالا رفته اما موقعیت‌های باز کم شده‌اند؛ بخشی از حرکت می‌تواند از بسته‌شدن موقعیت‌ها آمده باشد.';
  if(p< -1&&oi<-2)return 'قیمت پایین آمده و موقعیت‌های باز هم کاهش یافته‌اند؛ نشانه‌ای از خروج اهرمی دیده می‌شود.';
  if(Math.abs(fund)>.0008)return fund>0?'سمت لانگ‌ها شلوغ‌تر شده و هزینه نگهداری لانگ‌ها بالا رفته است.':'سمت شورت‌ها شلوغ‌تر شده و هزینه نگهداری شورت‌ها بالا رفته است.';
  if(taker>.08)return 'تراز خرید بازارسازان/خریداران تهاجمی مثبت است، اما تأیید چندگانه هنوز کامل نیست.';
  if(taker<-.08)return 'تراز فروش تهاجمی منفی است، اما برای نتیجه‌گیری قوی به تأیید قیمت و Open Interest نیاز است.';
  return 'سیگنال‌های جریان بزرگ‌معامله‌ای ترکیبی هستند؛ فعلاً برتری واضحی بین خرید و فروش دیده نمی‌شود.';
}
async function computeWhaleIntelligence(){
  if(whaleCache.running)return whaleCache.data;
  if(whaleCache.data&&Date.now()-whaleCache.t<5*60*1000)return whaleCache.data;
  whaleCache.running=true;
  try{
    const universe=await refreshMarketUniverse();
    const allowed=new Set(universe.map(x=>x.pair));
    const tickers=await futuresJson('/fapi/v1/ticker/24hr');
    const candidates=(Array.isArray(tickers)?tickers:[]).filter(x=>allowed.has(String(x.symbol||''))&&Number(x.quoteVolume)>0).sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume)).slice(0,12);
    const rows=await Promise.all(candidates.map(async t=>{
      const symbol=String(t.symbol);
      try{
        const [fund,oi,oiHist,taker,topAcc,topPos]=await Promise.all([
          futuresJson('/fapi/v1/fundingRate?symbol='+symbol+'&limit=1').catch(()=>[]),
          futuresJson('/fapi/v1/openInterest?symbol='+symbol).catch(()=>null),
          futuresJson('/futures/data/openInterestHist?symbol='+symbol+'&period=1h&limit=13').catch(()=>[]),
          futuresJson('/futures/data/takerlongshortRatio?symbol='+symbol+'&period=1h&limit=12').catch(()=>[]),
          futuresJson('/futures/data/topLongShortAccountRatio?symbol='+symbol+'&period=1h&limit=1').catch(()=>[]),
          futuresJson('/futures/data/topLongShortPositionRatio?symbol='+symbol+'&period=1h&limit=1').catch(()=>[])
        ]);
        const hist=Array.isArray(oiHist)?oiHist.filter(x=>Number.isFinite(Number(x.sumOpenInterestValue))):[];
        const oldOI=hist.length?Number(hist[0].sumOpenInterestValue):null;
        const newOI=hist.length?Number(hist[hist.length-1].sumOpenInterestValue):Number(oi?.openInterestValue||oi?.openInterest||0)*Number(t.lastPrice||0);
        const oiChange12h=oldOI&&newOI?((newOI-oldOI)/oldOI)*100:null;
        const tr=Array.isArray(taker)?taker:[]; 
        const buy=tr.reduce((a,x)=>a+Number(x.buyVol||x.buyVolValue||0),0);
        const sell=tr.reduce((a,x)=>a+Number(x.sellVol||x.sellVolValue||0),0);
        const takerImbalance12h=(buy+sell)?(buy-sell)/(buy+sell):0;
        const f=Array.isArray(fund)&&fund[0]?Number(fund[0].fundingRate):null;
        const a=Array.isArray(topAcc)&&topAcc[0]?topAcc[0]:null;
        const pos=Array.isArray(topPos)&&topPos[0]?topPos[0]:null;
        const longShort=Number(a?.longShortRatio);
        const positionRatio=Number(pos?.longShortRatio);
        let score=50+takerImbalance12h*130;
        if(Number.isFinite(oiChange12h))score+=Math.max(-15,Math.min(15,oiChange12h*1.5));
        score+=Math.max(-10,Math.min(10,Number(t.priceChangePercent||0)*1.2));
        if(Number.isFinite(f))score-=Math.max(-8,Math.min(8,f*10000));
        score=Math.round(Math.max(0,Math.min(100,score)));
        const signal=score>=68?'ACCUMULATION':score<=32?'DISTRIBUTION':'MIXED';
        return {
          symbol:symbol.replace('USDT',''),pair:symbol,price:Number(t.lastPrice),priceChange24h:Number(t.priceChangePercent),
          volume24h:Number(t.quoteVolume),fundingRate:f,openInterestValue:newOI,oiChange12h,
          takerBuy12h:buy,takerSell12h:sell,takerImbalance12h,longShortRatio:Number.isFinite(longShort)?longShort:null,
          topPositionRatio:Number.isFinite(positionRatio)?positionRatio:null,whaleScore:score,signal,
          narrative:''
        };
      }catch{return null}
    }));
    const leaders=rows.filter(Boolean).map(x=>({...x,narrative:whaleNarrative(x)})).sort((a,b)=>b.whaleScore-a.whaleScore);
    const buyPressure=leaders.length?leaders.reduce((a,x)=>a+Number(x.takerImbalance12h||0),0)/leaders.length:0;
    const avgOi=leaders.filter(x=>Number.isFinite(x.oiChange12h)).length?leaders.reduce((a,x)=>a+(Number.isFinite(x.oiChange12h)?x.oiChange12h:0),0)/leaders.filter(x=>Number.isFinite(x.oiChange12h)).length:null;
    const data={ok:true,generatedAt:new Date().toISOString(),window:'12h flow + 24h market context',source:'Binance Futures public market data',leaders:leaders.slice(0,6),marketSummary:{avgTakerImbalance12h:buyPressure,avgOiChange12h:avgOi,tracked:leaders.length},disclaimer:'این بخش از داده‌های عمومی مشتقات بایننس برای شناسایی فشار خرید/فروش و تغییر موقعیت‌ها استفاده می‌کند؛ «نهنگ» به معنی شناسایی هویت یک معامله‌گر خاص نیست و هیچ حرکت قیمتی تضمین‌شده نیست.'};
    whaleCache={t:Date.now(),data,running:false};
    return data;
  }catch{
    whaleCache.running=false;
    return whaleCache.data;
  }
}
app.get('/api/whale-intelligence',async(req,res)=>{
  const d=await computeWhaleIntelligence();
  if(!d)return res.status(503).json({error:'whale_intelligence_unavailable'});
  res.json(d);
});
setTimeout(()=>computeWhaleIntelligence().catch(()=>{}),9000);
setInterval(()=>computeWhaleIntelligence().catch(()=>{}),5*60*1000);

app.get('/api/daily-picks',optionalAuth,async(req,res)=>{
  const fresh=dailyPickCache.data&&Date.now()-dailyPickCache.t<5*60*1000;
  if(!fresh)await computeDailyPicks();
  if(!dailyPickCache.data)return res.status(503).json({error:'daily_picks_unavailable'});
  const d=dailyPickCache.data;
  const isPremium=req.user?.plan==='premium';
  res.json({
    ok:true,updatedAt:d.updatedAt,
    premium:isPremium,
    picks:isPremium?d.picks:d.picks.map(x=>({rank:x.rank,confidence:x.confidence,score:x.score,locked:true})),
    performance:d.performance,
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