import express from 'express';
import crypto from 'node:crypto';

console.log('[CryptoPilot] bootstrap starting', { node: process.version, cwd: process.cwd(), port: process.env.PORT || 3000 });
process.on('uncaughtException', (err) => console.error('[CryptoPilot] uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('[CryptoPilot] unhandledRejection', err));

// Payment receive address must be supplied through environment configuration. Never hardcode or overwrite it in source.

const originalStatic = express.static;
const originalPost = express.application.post;
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const analyticsScript = GA_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:true});</script>` : '';
const performanceScript = `<script src="/performance.js" defer></script><script src="/seo.js" defer></script>`;
const statusScript = `<script>
(()=>{const box=()=>document.getElementById('statusGrid');const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const paint=(label,value,ok)=>'<div class="statusBox"><small>'+label+'</small><strong class="'+(ok?'up':'down')+'">'+esc(value)+'</strong></div>';async function check(){try{const [btc,eth,scan]=await Promise.allSettled([fetch('/api/market/BTCUSDT?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),fetch('/api/market/ETHUSDT?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),fetch('/api/scanner?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject())]);const b=btc.status==='fulfilled'&&btc.value?.analysis?.price!=null;const e=eth.status==='fulfilled'&&eth.value?.analysis?.price!=null;const s=scan.status==='fulfilled'&&Array.isArray(scan.value?.results)&&scan.value.results.length>0;const market=b||e;const p=x=>x?.value?.provider||'market data';const el=box();if(!el)return;el.innerHTML=paint('Market API',market?'Online':'Offline',market)+paint('BTC',b?'Online · '+p(btc):'Offline',b)+paint('ETH',e?'Online · '+p(eth):'Offline',e)+paint('Scanner',s?'Online':'Offline',s);const led=document.querySelector('.led'),live=document.getElementById('liveText');if(led){led.style.background=market?'var(--green)':'var(--red)';led.style.boxShadow=market?'0 0 13px var(--green)':'0 0 13px var(--red)'}if(live)live.textContent=market?'LIVE':'OFFLINE';}catch{}}check();setInterval(check,30000);})();</script>`;

express.static = function(...args){
  const middleware = originalStatic.apply(express, args);
  return function statusInjectedStatic(req,res,next){
    const originalEnd = res.end; let buffering=true;
    res.end=function(chunk,encoding,cb){
      if(!buffering)return originalEnd.call(res,chunk,encoding,cb); buffering=false;
      try{
        const type=String(res.getHeader('content-type')||'');
        if(chunk && type.includes('text/html')){
          const body=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
          const injected=body.includes('</body>')?body.replace('</body>',analyticsScript+performanceScript+statusScript+'</body>'):body+analyticsScript+performanceScript+statusScript;
          res.removeHeader('content-length');res.removeHeader('etag');res.setHeader('Cache-Control','public, max-age=60, stale-while-revalidate=300');
          return originalEnd.call(res,Buffer.from(injected,'utf8'),undefined,cb);
        }
        const path=String(req.path||'');
        if(/\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(path))res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');
      }catch{}
      return originalEnd.call(res,chunk,encoding,cb);
    };
    return middleware(req,res,(err)=>{res.end=originalEnd;next(err)});
  };
};

// Screenshot AI has three free analyses per account. The existing server route is premium-gated,
// so this wrapper temporarily grants the route's premium check only after auth and only while
// the user still has free credits. Premium users remain unlimited.
const screenshotUsage = new Map();
express.application.post = function patchedPost(path,...handlers){
  if(path === '/api/ai/screenshot'){
    const gate = (req,res,next)=>{
      const userId=req.user?.id;
      if(!userId)return res.status(401).json({error:'unauthorized'});
      if(req.user?.plan==='premium')return next();
      const key=String(userId);
      const used=Number(screenshotUsage.get(key)||0);
      if(used>=3)return res.status(403).json({error:'premium_required',reason:'free_limit_reached'});
      screenshotUsage.set(key,used+1);
      req.user.plan='premium';
      next();
    };
    return originalPost.call(this,path,gate,...handlers);
  }
  return originalPost.call(this,path,...handlers);
};

// Install the verifier before payment-wrapper. payment-wrapper will call this patched listener as its final listen layer.
await import('./payment-verifier.js');

express.application.response = express.response;
await import('./payment-wrapper.js');