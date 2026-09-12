import express from 'express';

const originalStatic = express.static;
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const analyticsScript = GA_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:true});</script>` : '';
const statusScript = `<script>
(()=>{
  const box=()=>document.getElementById('statusGrid');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paint=(label,value,ok)=>'<div class="statusBox"><small>'+label+'</small><strong class="'+(ok?'up':'down')+'">'+esc(value)+'</strong></div>';
  async function check(){
    try{
      const [btc,eth,scan]=await Promise.allSettled([
        fetch('/api/market/BTCUSDT?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),
        fetch('/api/market/ETHUSDT?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),
        fetch('/api/scanner?tf=15m',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject())
      ]);
      const b=btc.status==='fulfilled'&&btc.value?.analysis?.price!=null;
      const e=eth.status==='fulfilled'&&eth.value?.analysis?.price!=null;
      const s=scan.status==='fulfilled'&&Array.isArray(scan.value?.results)&&scan.value.results.length>0;
      const market=b||e;
      const p=x=>x?.value?.provider||'market data';
      const el=box(); if(!el)return;
      el.innerHTML=paint('Market API',market?'Online':'Offline',market)+paint('BTC',b?'Online · '+p(btc):'Offline',b)+paint('ETH',e?'Online · '+p(eth):'Offline',e)+paint('Scanner',s?'Online':'Offline',s);
      const led=document.querySelector('.led'),live=document.getElementById('liveText');
      if(led){led.style.background=market?'var(--green)':'var(--red)';led.style.boxShadow=market?'0 0 13px var(--green)':'0 0 13px var(--red)'}
      if(live)live.textContent=market?'LIVE':'OFFLINE';
    }catch{}
  }
  check(); setInterval(check,30000);
})();
</script>`;

express.static = function(...args){
  const middleware = originalStatic.apply(express, args);
  return function statusInjectedStatic(req,res,next){
    const originalEnd = res.end;
    let buffering=true;
    res.end=function(chunk, encoding, cb){
      if(!buffering)return originalEnd.call(res,chunk,encoding,cb);
      buffering=false;
      try{
        const type=String(res.getHeader('content-type')||'');
        if(chunk && type.includes('text/html')){
          const body=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
          const injected=body.includes('</body>')?body.replace('</body>',analyticsScript+statusScript+'</body>'):body+analyticsScript+statusScript;
          res.removeHeader('content-length');
          res.removeHeader('etag');
          return originalEnd.call(res,Buffer.from(injected,'utf8'),undefined,cb);
        }
      }catch{}
      return originalEnd.call(res,chunk,encoding,cb);
    };
    return middleware(req,res,(err)=>{res.end=originalEnd;next(err)});
  };
};

await import('./payment-wrapper.js');
