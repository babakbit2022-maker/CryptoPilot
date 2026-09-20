(()=>{ 
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':'$'+Number(n).toLocaleString(undefined,{maximumFractionDigits:Number(n)<1?8:2});
  let timer=null, lastKey='';
  function css(){if($('cpAiStyle'))return;const s=document.createElement('style');s.id='cpAiStyle';s.textContent=`
  .cp-ai-deep{margin-top:14px;border:1px solid #2a4661;border-radius:16px;background:linear-gradient(135deg,#0a1a2a,#11172b);overflow:hidden}
  .cp-ai-deep-head{padding:15px 16px;border-bottom:1px solid #1b3045;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
  .cp-ai-kicker{font-size:9px;letter-spacing:1.5px;color:#8194aa;text-transform:uppercase}.cp-ai-deep-title{font-size:20px;font-weight:950;margin-top:3px}.cp-ai-deep-sub{color:#91a4b8;font-size:11px;margin-top:3px}
  .cp-ai-engine{font-size:9px;font-weight:900;padding:7px 9px;border:1px solid #28503f;background:#0a211b;color:#a9e9d0;border-radius:999px;white-space:nowrap}
  .cp-ai-engine.fallback{border-color:#4a4250;background:#211a24;color:#f0c9a4}
  .cp-ai-body{padding:15px 16px}.cp-ai-profile{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}
  .cp-ai-box{background:#081624;border:1px solid #182d43;border-radius:11px;padding:10px}.cp-ai-box small{display:block;color:#8194aa;font-size:9px;text-transform:uppercase}.cp-ai-box b{display:block;margin-top:4px;font-size:12px}
  .cp-ai-report{display:grid;gap:8px}.cp-ai-section{background:#081624;border:1px solid #182d43;border-radius:11px;padding:11px}.cp-ai-section h4{margin:0 0 5px;font-size:12px;color:#dce7f2}.cp-ai-section p{margin:0;color:#a9bacb;font-size:11px;line-height:1.75;white-space:pre-wrap}
  .cp-ai-scenarios{display:grid;grid-template-columns:1fr 1fr;gap:9px}.cp-ai-scenarios .cp-ai-section:first-child{border-color:#24503f}.cp-ai-scenarios .cp-ai-section:last-child{border-color:#51313a}
  .cp-ai-foot{padding:10px 16px;border-top:1px solid #1b3045;color:#65798e;font-size:9px}.cp-ai-loading{color:#8fa2b6;font-size:11px;padding:8px 0}
  @media(max-width:700px){.cp-ai-profile,.cp-ai-scenarios{grid-template-columns:1fr}.cp-ai-deep-head{flex-direction:column}}
  `;document.head.appendChild(s)}
  function key(){const q=new URLSearchParams(location.search);return (q.get('symbol')||'BTCUSDT').toUpperCase()+'|'+(q.get('tf')||'1h')}
  function sectionize(report){
    const lines=String(report||'').split(/\n+/).map(x=>x.trim()).filter(Boolean), out=[];let cur=null;
    for(const line of lines){if(/^\d+\)/.test(line)){if(cur)out.push(cur);cur={h:line.replace(/^\d+\)\s*/,''),p:''};}else if(cur)cur.p+=(cur.p?'\n':'')+line;else cur={h:'AI Analysis',p:line}}
    if(cur)out.push(cur);return out;
  }
  function render(v){
    css();let root=$('cpAiDeep');if(!root){const grid=document.querySelector('.aiGrid');if(!grid)return;grid.insertAdjacentHTML('beforebegin',`<div id="cpAiDeep" class="cp-ai-deep"></div>`);root=$('cpAiDeep')}
    const a=v.analysis||{}, sections=sectionize(v.report);
    const normal=sections.filter(x=>!/^سناریوی (صعودی|نزولی)$/i.test(x.h));
    const scenarios=sections.filter(x=>/^سناریوی (صعودی|نزولی)$/i.test(x.h));
    root.innerHTML=`<div class="cp-ai-deep-head"><div><div class="cp-ai-kicker">CryptoPilot AI · Live chart intelligence</div><div class="cp-ai-deep-title">تحلیل هوشمند ${esc(v.symbol||'')}</div><div class="cp-ai-deep-sub">${esc(a.tf||new URLSearchParams(location.search).get('tf')||'1h')} · تحلیل چندتایم‌فریمی · به‌روزرسانی زنده</div></div><span class="cp-ai-engine ${v.source==='openai'?'':'fallback'}">${v.source==='openai'?'AI ENGINE · LIVE':'TECHNICAL ENGINE'}</span></div><div class="cp-ai-body"><div class="cp-ai-profile"><div class="cp-ai-box"><small>حوزه / کاربرد</small><b>${esc(v.sector||'نیازمند بررسی')}</b><span style="display:block;color:#8fa2b6;font-size:10px;margin-top:4px">${esc(v.useCase||'')}</span></div><div class="cp-ai-box"><small>وضعیت تکنیکال</small><b>${esc(a.setup||'NEUTRAL').replaceAll('_',' ')}</b><span style="display:block;color:#8fa2b6;font-size:10px;margin-top:4px">RSI ${a.rsi==null?'—':Number(a.rsi).toFixed(1)} · Risk ${a.riskScore==null?'—':a.riskScore+'/100'} · Support ${money(a.support)} · Resistance ${money(a.resistance)}</span></div></div><div class="cp-ai-report">${normal.map(x=>`<div class="cp-ai-section"><h4>${esc(x.h)}</h4><p>${esc(x.p)}</p></div>`).join('')}</div>${scenarios.length?`<div class="cp-ai-scenarios" style="margin-top:8px">${scenarios.map(x=>`<div class="cp-ai-section"><h4>${esc(x.h)}</h4><p>${esc(x.p)}</p></div>`).join('')}</div>`:''}</div><div class="cp-ai-foot">تحلیل بر اساس داده بازار و ساختار چارت است؛ سناریوها شرطی هستند و تضمین رشد یا سقوط و توصیه مالی شخصی نیستند.</div>`;
  }
  function askPanel(){
    if($('cpAiAsk'))return;
    const host=$('cpAiDeep'); if(!host)return;
    const box=document.createElement('div'); box.id='cpAiAsk'; box.className='cp-ai-ask';
    box.innerHTML='<div class="cp-ai-ask-title">💬 از CryptoPilot AI سؤال بپرس</div><div class="cp-ai-ask-sub">هر ارزی را انتخاب کن و سؤال خودت را مستقیم بپرس؛ مثلاً: «نظرت درباره خرید DOGE چیه؟»</div><div class="cp-ai-ask-row"><input id="cpAiQuestion" placeholder="مثلاً: آیا الان خرید این ارز منطقی است؟ کوتاه‌مدت، میان‌مدت و بلندمدت را بگو"><button id="cpAiAskBtn">تحلیل کن</button></div><div class="cp-ai-chips"><button data-q="نظرت درباره خرید این ارز چیه؟ کوتاه‌مدت، میان‌مدت و بلندمدت را کامل توضیح بده.">خرید این ارز چطور است؟</button><button data-q="الان مهم‌ترین دلیل رشد یا ریزش این ارز چیست؟">چرا ممکن است رشد یا ریزش کند؟</button><button data-q="ریسک این ارز در شرایط فعلی چقدر است و چه چیزی را باید زیر نظر داشته باشم؟">ریسک و نکات مهم</button></div><div id="cpAiAnswer"></div>';
    host.parentNode.insertBefore(box,host);
    const send=async()=>{const q=$('cpAiQuestion')?.value.trim();if(!q)return;const btn=$('cpAiAskBtn'),ans=$('cpAiAnswer');btn.disabled=true;ans.innerHTML='<div class="cp-ai-answer-loading">در حال بررسی قیمت، حجم، مومنتوم، حمایت/مقاومت و تایم‌فریم‌ها…</div>';
      try{const p=new URLSearchParams(location.search),symbol=(p.get('symbol')||'BTCUSDT').toUpperCase();const r=await fetch('/api/ai/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,question:q})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'ask');ans.innerHTML='<div class="cp-ai-answer"><div class="cp-ai-answer-head"><b>پاسخ CryptoPilot AI</b><span>'+esc(j.asOf||new Date().toLocaleString())+'</span></div><div class="cp-ai-answer-text">'+esc(j.answer||'پاسخی دریافت نشد.')+'</div></div>';}catch(e){ans.innerHTML='<div class="cp-ai-answer-loading">تحلیل سؤال فعلاً در دسترس نیست. لطفاً چند لحظه بعد دوباره امتحان کن.</div>';}finally{btn.disabled=false;}};
    $('cpAiAskBtn').addEventListener('click',send);$('cpAiQuestion').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});box.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>{$('cpAiQuestion').value=b.dataset.q;send()}));
  }
  async function run(force=false){
    const k=key();if(!force&&k===lastKey&&$('cpAiDeep')?.dataset.loaded==='1')return;lastKey=k;
    css();let root=$('cpAiDeep');if(!root){const grid=document.querySelector('.aiGrid');if(!grid)return;grid.insertAdjacentHTML('beforebegin',`<div id="cpAiDeep" class="cp-ai-deep"><div class="cp-ai-body"><div class="cp-ai-loading">در حال تحلیل تخصصی ارز و ساختار چارت…</div></div></div>`);root=$('cpAiDeep')}else root.innerHTML='<div class="cp-ai-body"><div class="cp-ai-loading">در حال تحلیل تخصصی ارز و ساختار چارت…</div></div>';
    askPanel();
    try{const q=new URLSearchParams(location.search),symbol=(q.get('symbol')||'BTCUSDT').toUpperCase(),tf=q.get('tf')||'1h';const r=await fetch(`/api/ai/chart-analysis?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&_=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'ai');root.dataset.loaded='1';render(j);}
    catch{root.innerHTML='<div class="cp-ai-body"><div class="cp-ai-loading">تحلیل هوشمند فعلاً در دسترس نیست؛ داده زنده چارت همچنان فعال است.</div></div>';root.dataset.loaded='0';}
  }
  function wire(){const coin=$('coin');coin?.addEventListener('change',()=>setTimeout(()=>run(true),120));document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>run(true),120)));run(true);if(timer)clearInterval(timer);timer=setInterval(()=>run(true),90000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();