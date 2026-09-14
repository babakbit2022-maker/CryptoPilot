import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

const nativeFetch = globalThis.fetch;
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const originalListen = express.application.listen;
const db = new Database(process.env.DB_PATH || 'cryptopilot.db');
db.exec(`CREATE TABLE IF NOT EXISTS payment_orders(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,txid TEXT UNIQUE NOT NULL,event_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

function cookieValue(req,name){const h=String(req.headers.cookie||'');const m=h.match(new RegExp('(?:^|;\\s*)'+name.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}
function authUser(req){try{const secret=process.env.JWT_SECRET;if(!secret||secret.length<32)return null;const bearer=String(req.headers.authorization||'');const raw=bearer.startsWith('Bearer ')?bearer.slice(7):cookieValue(req,'cp_session');if(!raw)return null;const p=jwt.verify(raw,secret);return db.prepare('SELECT id,email,plan,role FROM users WHERE id=?').get(p.id)||null;}catch{return null;}}
function config(){const wallet=String(process.env.USDT_TRC20_WALLET||process.env.TRON_RECEIVE_ADDRESS||'').trim();const amount=Number(process.env.PREMIUM_USDT_AMOUNT||3);return{wallet,amount:Number.isFinite(amount)&&amount>0?amount:3};}
function headers(){const h={accept:'application/json'};const key=String(process.env.TRONGRID_API_KEY||'').trim();if(key)h['TRON-PRO-API-KEY']=key;return h;}
async function findTransfer(txid){
  const {wallet,amount}=config();
  if(!wallet)throw new Error('payment_not_configured');
  const u=new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet)}/transactions/trc20`);
  u.searchParams.set('limit','200');
  u.searchParams.set('contract_address',USDT_CONTRACT);
  u.searchParams.set('only_confirmed','true');
  const r=await nativeFetch(u,{headers:headers(),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error(`trongrid_http_${r.status}`);
  const j=await r.json();
  const row=(Array.isArray(j.data)?j.data:[]).find(x=>String(x.transaction_id||'').toLowerCase()===txid.toLowerCase());
  if(!row)return{found:false};
  const token=row.token_info||{};
  const decimals=Number(token.decimals||6);
  const value=Number(row.value)/Math.pow(10,decimals);
  const recipient=String(row.to||'');
  const symbol=String(token.symbol||'').toUpperCase();
  const contract=String(token.address||'');
  const ok=symbol==='USDT'&&contract===USDT_CONTRACT&&recipient===wallet&&Number.isFinite(value)&&value+1e-9>=amount;
  return{found:true,valid:ok,value,amount,recipient,contract,symbol,blockTimestamp:row.block_timestamp||null};
}

express.application.listen=function verifierListen(...args){
  const app=this;
  app.post('/api/payment/verify',async(req,res)=>{
    try{
      const u=authUser(req);if(!u)return res.status(401).json({error:'unauthorized'});
      const txid=String(req.body?.txid||'').trim();if(!/^[a-fA-F0-9]{64}$/.test(txid))return res.status(400).json({error:'invalid_txid'});
      const existing=db.prepare('SELECT * FROM payment_orders WHERE txid=?').get(txid);
      if(existing && existing.user_id && Number(existing.user_id)!==Number(u.id))return res.status(409).json({error:'txid_already_claimed'});
      const result=await findTransfer(txid);
      if(!result.found){
        if(!existing)db.prepare('INSERT OR IGNORE INTO payment_orders(user_id,txid,event_id,status) VALUES(?,?,?,?)').run(u.id,txid,crypto.createHash('sha256').update(`tron:${txid}`).digest('hex'),'pending');
        return res.status(202).json({ok:true,status:'pending',verified:false,message:'Transaction not found in confirmed TRC20 history yet.'});
      }
      if(!result.valid)return res.status(422).json({ok:false,status:'rejected',verified:false,error:'payment_mismatch',message:'Transaction exists but does not match the configured USDT TRC20 wallet and amount.'});
      const eventId=crypto.createHash('sha256').update(`tron:${txid}`).digest('hex');
      db.prepare('INSERT OR IGNORE INTO payment_orders(user_id,txid,event_id,status) VALUES(?,?,?,?)').run(u.id,txid,eventId,'confirmed');
      db.prepare('UPDATE payment_orders SET user_id=?,status=? WHERE txid=?').run(u.id,'confirmed',txid);
      try{db.prepare("UPDATE users SET plan='premium' WHERE id=?").run(u.id);}catch{}
      res.json({ok:true,status:'confirmed',verified:true,amount:result.value,network:'TRC20',asset:'USDT',txid});
    }catch(e){res.status(502).json({ok:false,status:'verification_unavailable',verified:false,error:'verification_unavailable',message:e.message});}
  });
  app.get('/api/payment/verification-engine',(req,res)=>res.json({ok:true,engine:'trongrid-trc20',automatic:true,asset:'USDT',network:'TRC20',contract:USDT_CONTRACT}));
  return originalListen.apply(app,args);
};
