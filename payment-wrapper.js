import express from 'express';
import crypto from 'node:crypto';

// Resilient outbound market-data routing. Abasthan may reach one Binance edge but not another.
const nativeFetch = globalThis.fetch;
const binanceHosts = ['api.binance.com','api1.binance.com','api2.binance.com','api3.binance.com','api4.binance.com'];
globalThis.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input?.url || '';
  if (raw.includes('api.binance.com')) {
    const u = new URL(raw);
    let last;
    for (const host of binanceHosts) {
      try {
        u.host = host;
        const r = await nativeFetch(u, { ...init, signal: init.signal || AbortSignal.timeout(9000) });
        if (r.ok || r.status < 400) return r;
        last = new Error(`Binance HTTP ${r.status}`);
      } catch (e) { last = e; }
    }
    throw last || new Error('Binance unavailable');
  }
  return nativeFetch(input, init);
};

const originalListen = express.application.listen;
function validTxid(txid) { return /^[a-fA-F0-9]{64}$/.test(txid); }
function getPaymentConfig() {
  const wallet = String(process.env.USDT_TRC20_WALLET || process.env.TRON_RECEIVE_ADDRESS || '').trim();
  const amount = Number(process.env.PREMIUM_USDT_AMOUNT || 3);
  const tronApiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  return { enabled:Boolean(wallet), network:'TRC20', asset:'USDT', wallet, amount:Number.isFinite(amount)&&amount>0?amount:3, verification:tronApiKey?'automatic_ready':'manual_pending_trongrid_key' };
}
express.application.listen = function patchedListen(...args) {
  const app = this;
  app.get('/api/payment/config',(req,res)=>{const cfg=getPaymentConfig();if(!cfg.enabled)return res.status(503).json({enabled:false,network:'TRC20',asset:'USDT',error:'payment_not_configured'});res.json({ok:true,...cfg});});
  app.post('/api/payment/submit',(req,res,next)=>{try{const ah=String(req.headers.authorization||''),ch=String(req.headers.cookie||'');if(!ah.startsWith('Bearer ')&&!ch.includes('cp_session='))return res.status(401).json({error:'unauthorized'});const txid=String(req.body?.txid||'').trim();if(!validTxid(txid))return res.status(400).json({error:'invalid_txid'});const eventId=crypto.createHash('sha256').update(`tron:${txid}`).digest('hex');res.status(202).json({ok:true,status:'pending',eventId,txid,network:'TRC20',asset:'USDT',message:'Transaction received for verification.'});}catch(e){next(e);}});
  app.get('/api/payment/status',(req,res)=>{const cfg=getPaymentConfig();res.json({ok:true,configured:cfg.enabled,network:cfg.network,asset:cfg.asset,amount:cfg.amount,verification:cfg.verification});});
  return originalListen.apply(app,args);
};
await import('./server.js');
