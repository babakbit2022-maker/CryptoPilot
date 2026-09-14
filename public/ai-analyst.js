(()=>{
  const q=new URLSearchParams(location.search), pair=(q.get('symbol')||'BTCUSDT').toUpperCase(), tf=q.get('tf')||'1h';
  const $=id=>document.getElementById(id);
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':'$'+Number(n).toLocaleString(undefined,{maximumFractionDigits:Number(n)<1?8:2});
  const pct=n=>n==null||!Number.isFinite(Number(n))?'—':(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function verdict(a){
    const bull=Number(a.bullScore||0),bear=Number(a.bearScore||0),risk=Number(a.riskScore||50),r=a.rsi;
    let label='NEUTRAL / WAIT',tone='neutral';
    if(bull>=72&&bull>bear+12&&risk<70){label='BULLISH BIAS';tone='up';}
    else if(bear>=72&&bear>bull+12&&risk<70){label='BEARISH BIAS';tone='down';}
    else if(risk>=75){label='HIGH RISK — WAIT FOR CONFIRMATION';tone='warn';}
    const parts=[];
    if(a.ema20&&a.ema50&&a.ema200){parts.push(a.price>a.ema20&&a.ema20>a.ema50?'short-term trend is above its moving averages':a.price<a.ema20&&a.ema20<a.ema50?'short-term trend is below its moving averages':'moving-average structure is mixed');}
    if(r!=null)parts.push(r>=70?'RSI is elevated':r<=30?'RSI is oversold':'RSI is in a non-extreme zone');
    if(a.volumeRatio!=null)parts.push(a.volumeRatio>=1.5?'volume is unusually active':a.volumeRatio>=1.2?'volume is above its recent average':'volume is not strongly confirming the move');
    if(a.support!=null&&a.resistance!=null)parts.push(`support ${money(a.support)} / resistance ${money(a.resistance)}`);
    return {label,tone,text:parts.join(' · ')};
  }
  function build(a){
    const v=verdict(a), mom=pct(Number(a.momentum||0)*100), vr=a.volumeRatio==null?'—':Number(a.volumeRatio).toFixed(2)+'x';
    const long=a.tradeLevels?.long,short=a.tradeLevels?.short;
    return `<div id="cpAiBrief" class="cp-ai-brief"><div class="cp-ai-top"><div><div class="cp-ai-kicker">CRYPTO PILOT AI · LIVE VERDICT</div><div class="cp-ai-label ${v.tone}">${esc(v.label)}</div></div><div class="cp-ai-score">${Number(a.bullScore||0)} <span>BULL</span> · ${Number(a.bearScore||0)} <span>BEAR</span></div></div><p>${esc(v.text||'Waiting for enough market data.')}</p><div class="cp-ai-grid"><div><small>Momentum</small><b>${mom}</b></div><div><small>Volume</small><b>${vr}</b></div><div><small>Risk</small><b>${Number(a.riskScore||0)}/100</b></div><div><small>RSI</small><b>${a.rsi==null?'—':Number(a.rsi).toFixed(1)}</b></div></div><div class="cp-ai-levels"><div><small>Potential long map</small><b>${long?money(long.entry)+' → '+money(long.tp1)+' / SL '+money(long.stop):'Not enough data'}</b></div><div><small>Potential short map</small><b>${short?money(short.entry)+' → '+money(short.tp1)+' / SL '+money(short.stop):'Not enough data'}</b></div></div><div class="cp-ai-note">This is an automated technical interpretation of the live feed, not a guarantee or financial advice.</div></div>`;
  }
  function premiumize(){
    const grid=document.querySelector('.aiGrid'); if(!grid||grid.dataset.aiWired)return; grid.dataset.aiWired='1';
    grid.querySelectorAll('.aiCard.premium').forEach(c=>{c.style.cursor='pointer';c.addEventListener('click',()=>location.href='/payment.html');});
    const quick=[...grid.querySelectorAll('.aiCard')].find(c=>c.textContent.includes('Quick AI Verdict'));
    if(quick){quick.style.cursor='pointer';quick.addEventListener('click',()=>document.getElementById('cpAiBrief')?.scrollIntoView({behavior:'smooth',block:'center'}));}
  }
  function injectStyle(){if($('cpAiStyle'))return;const s=document.createElement('style');s.id='cpAiStyle';s.textContent='.cp-ai-brief{margin-top:14px;border:1px solid #29445d;border-radius:15px;padding:15px;background:linear-gradient(135deg,#0b1b2b,#11152a);box-shadow:0 10px 35px rgba(0,0,0,.18)}.cp-ai-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cp-ai-kicker{font-size:9px;letter-spacing:1.4px;color:#8194aa}.cp-ai-label{font-size:19px;font-weight:950;margin-top:3px}.cp-ai-label.up{color:#35d69b}.cp-ai-label.down{color:#ff6378}.cp-ai-label.warn{color:#f5c85b}.cp-ai-label.neutral{color:#64e6ff}.cp-ai-score{font-size:12px;font-weight:900;color:#dce7f2}.cp-ai-score span{font-size:9px;color:#8194aa}.cp-ai-brief p{color:#a9bacb;font-size:12px;margin:10px 0}.cp-ai-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cp-ai-grid>div,.cp-ai-levels>div{background:#081624;border:1px solid #182d43;border-radius:10px;padding:9px}.cp-ai-brief small{display:block;color:#8194aa;font-size:9px;text-transform:uppercase}.cp-ai-brief b{display:block;margin-top:3px;font-size:12px}.cp-ai-levels{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.cp-ai-note{font-size:9px;color:#61748a;margin-top:10px}@media(max-width:600px){.cp-ai-grid{grid-template-columns:repeat(2,1fr)}.cp-ai-levels{grid-template-columns:1fr}.cp-ai-top{flex-direction:column}}';document.head.appendChild(s)}
  async function run(){
    try{const r=await fetch(`/api/market/${encodeURIComponent(pair)}?tf=${encodeURIComponent(tf)}`,{cache:'no-store'}),j=await r.json();if(!r.ok||!j.analysis)throw Error('market');
      injectStyle(); const grid=document.querySelector('.aiGrid'); if(grid&&!$('cpAiBrief')) grid.insertAdjacentHTML('afterend',build(j.analysis)); premiumize();
    }catch{ /* Existing market page remains usable; the core live chart handles its own retry. */ }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
