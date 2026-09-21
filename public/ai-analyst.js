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
  .cp-shot-result{margin-top:14px;border-top:1px solid #1b3045;padding-top:14px}.cp-shot-meta{display:flex;justify-content:space-between;gap:10px;color:#91a4b8;font-size:10px;margin-bottom:9px}.cp-shot-meta b{color:#dce7f2;font-size:13px}.cp-shot-stage{position:relative;width:100%;overflow:hidden;border:1px solid #29425b;border-radius:14px;background:#050d16}.cp-shot-stage img{display:block;width:100%;height:auto;max-height:720px;object-fit:contain}.cp-shot-markers{position:absolute;inset:0}.cp-shot-marker{position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;border:2px solid #fff;background:#ff6378;color:#fff;font-weight:950;cursor:pointer;box-shadow:0 3px 16px rgba(0,0,0,.55)}.cp-shot-marker:focus,.cp-shot-marker:hover{outline:3px solid #64e6ff;z-index:3}.cp-shot-summary,.cp-shot-watch{margin-top:10px;background:#081624;border:1px solid #182d43;border-radius:11px;padding:12px}.cp-shot-summary b,.cp-shot-watch b{font-size:12px}.cp-shot-summary p,.cp-shot-watch p,.cp-shot-point p,.cp-shot-point small,.cp-shot-scenarios p{display:block;margin:5px 0 0;color:#a9bacb;font-size:11px;line-height:1.75}.cp-shot-points{display:grid;gap:8px;margin-top:9px}.cp-shot-point{background:#081624;border:1px solid #182d43;border-radius:11px;padding:11px;cursor:pointer}.cp-shot-point.active{border-color:#64e6ff;box-shadow:0 0 0 1px rgba(100,230,255,.18)}.cp-shot-point-head{display:flex;align-items:center;gap:8px}.cp-shot-num{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#ff6378;color:#fff;font-weight:950;font-size:11px}.cp-shot-scenarios{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:9px}.cp-shot-scenarios article{background:#081624;border:1px solid #182d43;border-radius:11px;padding:11px}.cp-shot-scenarios article:first-child{border-color:#24503f}.cp-shot-scenarios article:last-child{border-color:#51313a}.cp-shot-scenarios b{font-size:12px}.cp-ai-ask{margin-top:14px;border:1px solid #2a4661;border-radius:16px;background:#0a1624;padding:15px 16px}.cp-ai-ask-title{font-size:15px;font-weight:950}.cp-ai-ask-sub{color:#91a4b8;font-size:11px;margin-top:3px;line-height:1.7}.cp-ai-ask .select{padding:10px}.cp-ai-ask .primary{border:0;border-radius:10px;padding:10px 16px;background:linear-gradient(135deg,#48b9ff,#8f87ff);color:#06101c;font-weight:900;cursor:pointer}.cp-ai-ask .primary:disabled{opacity:.55;cursor:not-allowed}
  @media(max-width:700px){.cp-ai-profile,.cp-ai-scenarios{grid-template-columns:1fr}.cp-ai-deep-head{flex-direction:column}}
  `;document.head.appendChild(s)}
  function key(){const q=new URLSearchParams(location.search);return (q.get('symbol')||'BTCUSDT').toUpperCase()+'|'+(q.get('tf')||'1h')}
  function sectionize(report){
    const lines=String(report||'').split(/\n+/).map(x=>x.trim()).filter(Boolean), out=[];let cur=null;
    for(const line of lines){if(/^\d+\)/.test(line)){if(cur)out.push(cur);cur={h:line.replace(/^\d+\)\s*/,''),p:''};}else if(cur)cur.p+=(cur.p?'\n':'')+line;else cur={h:'AI Analysis',p:line}}
    if(cur)out.push(cur);return out;
  }
  function render(v){
    css();let root=$('cpAiDeep');if(!root){const grid=document.querySelector('.aiGrid');if(!grid)return;grid.insertAdjacentHTML('beforebegin',\`<div id="cpAiDeep" class="cp-ai-deep"></div>\`);root=$('cpAiDeep')}
    root.innerHTML=\`<div class="cp-ai-deep-head"><div><div class="cp-ai-kicker">CryptoPilot AI · Premium intelligence</div><div class="cp-ai-deep-title">AI Analysis ${esc(v.symbol||'')}</div><div class="cp-ai-deep-sub">The live chart remains open. The AI interpretation is intentionally separate and locked.</div></div><span class="cp-ai-engine">🔒 PREMIUM</span></div><div class="cp-ai-body"><div class="cp-ai-profile"><div class="cp-ai-box"><small>What Premium unlocks</small><b>AI market interpretation</b><span style="display:block;color:#8fa2b6;font-size:10px;margin-top:4px">Trend context, momentum interpretation and risk explanation in simple language.</span></div><div class="cp-ai-box"><small>Separate from chart</small><b>No duplicated raw indicators</b><span style="display:block;color:#8fa2b6;font-size:10px;margin-top:4px">The chart shows raw market/technical data; AI explains what those signals may mean.</span></div></div><div class="cp-ai-section"><h4>🔒 Premium AI report</h4><p>Unlock the full AI report to receive the asset-specific explanation, market scenarios, key changes, confirmation conditions and risk-aware interpretation.</p></div><div class="cta"><div><b>Unlock the full AI answer</b><span>Premium keeps the useful interpretation behind payment while the live market chart stays available.</span></div><a class="primary" href="/payment.html">Unlock Premium</a></div></div><div class="cp-ai-foot">AI analysis is educational and conditional; it is not guaranteed or personalized financial advice.</div>\`;
  }

  async function loadScreenshotCoins(sel){
    sel.innerHTML='<option value="">Loading all supported assets…</option>';
    try{
      const r=await fetch('/api/coins',{cache:'no-store'});
      if(!r.ok)throw Error('HTTP '+r.status);
      const d=await r.json();
      const coins=Array.isArray(d.coins)?d.coins:(Array.isArray(d.data)?d.data:(Array.isArray(d.results)?d.results:[]));
      const normalized=coins.map(x=>{
        const raw=String(x.symbol||x.ticker||x.baseSymbol||'').toUpperCase().replace(/USDT$/,'');
        return {symbol:raw,name:String(x.name||x.coinName||raw)};
      }).filter(x=>/^[A-Z0-9]{2,20}$/.test(x.symbol));
      const unique=Array.from(new Map(normalized.map(x=>[x.symbol,x])).values());
      if(!unique.length)throw Error('No assets returned');
      unique.sort((a,b)=>a.name.localeCompare(b.name));
      sel.innerHTML=unique.map(x=>'<option value="'+esc(x.symbol)+'">'+esc(x.name)+' ('+esc(x.symbol)+')</option>').join('');
      const current=(new URLSearchParams(location.search).get('symbol')||'BTC').replace(/USDT$/i,'').toUpperCase();
      if(unique.some(x=>x.symbol===current))sel.value=current;
    }catch(e){
      sel.innerHTML='<option value="BTC">BTC (temporary fallback)</option>';
      sel.dataset.loadError=String(e.message||e);
    }
  }
  function screenshotPanel(){
    if($('cpAiScreenshot'))return;
    const host=$('cpAiDeep');if(!host)return;
    const box=document.createElement('div');box.id='cpAiScreenshot';box.className='cp-ai-ask';
    box.innerHTML='<div class="cp-ai-ask-title">📸 AI Chart Screenshot Lab · 🔒 PREMIUM</div>'+
      '<div class="cp-ai-ask-sub">اول بازار را انتخاب کن، سپس تصویر چارت خودت را بفرست. هوش مصنوعی تصویر را می‌خواند و روی همان تصویر نقاط مهم را مشخص می‌کند.</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:9px;margin-top:12px">'+
      '<label style="display:block;color:#91a4b8;font-size:10px">Asset<select id="cpShotCoin" class="select" style="width:100%;margin-top:5px;background:#081624;color:#fff;border:1px solid #182d43;border-radius:10px"></select></label>'+
      '<label style="display:block;color:#91a4b8;font-size:10px">Chart screenshot<input id="cpShotFile" type="file" accept="image/png,image/jpeg,image/webp" style="display:block;width:100%;margin-top:5px;color:#9eb0c3"></label>'+
      '</div>'+
      '<div style="margin-top:10px;color:#71859a;font-size:10px">تصویر خوانا از کندل‌ها، تایم‌فریم، حجم و اندیکاتورها دقت تحلیل بصری را بیشتر می‌کند.</div>'+
      '<div class="cta"><div><b id="cpShotCtaTitle">Checking Premium access…</b><span id="cpShotCtaSub">برای اجرای تحلیل تصویری، دسترسی Premium لازم است.</span></div><button id="cpShotBtn" class="primary" type="button">Check access</button></div>'+
      '<div id="cpShotAnswer"></div>';
    host.parentNode.insertBefore(box,host.nextSibling);
    const sel=$('cpShotCoin'),btn=$('cpShotBtn'),ans=$('cpShotAnswer');
    loadScreenshotCoins(sel);
    const renderAnalysis=(j,symbol,data)=>{
      const a=j.analysis||{},points=Array.isArray(a.points)?a.points:[],src=esc(data);
      ans.innerHTML='<div class="cp-shot-result"><div class="cp-shot-meta"><b>'+esc(symbol.replace('USDT',''))+' · Visual AI Analysis</b><span>'+esc(j.asOf||'')+'</span></div>'+
        '<div class="cp-shot-stage"><img src="'+src+'" alt="Uploaded '+esc(symbol)+' chart screenshot"><div class="cp-shot-markers">'+points.map(p=>'<button type="button" class="cp-shot-marker" data-point="'+esc(p.id)+'" style="left:'+Number(p.x)+'%;top:'+Number(p.y)+'%" title="'+esc(p.title)+'">'+esc(p.id)+'</button>').join('')+'</div></div>'+
        '<div class="cp-shot-summary"><b>جمع‌بندی ساده</b><p>'+esc(a.summary||'اطلاعات کافی برای جمع‌بندی مطمئن دیده نشد.')+'</p></div>'+
        '<div class="cp-shot-points">'+points.map(p=>'<article class="cp-shot-point" data-point-card="'+esc(p.id)+'"><div class="cp-shot-point-head"><span class="cp-shot-num">'+esc(p.id)+'</span><b>'+esc(p.title)+'</b></div><p>'+esc(p.explanation)+'</p><small>نکته کاربردی: '+esc(p.lesson)+'</small></article>').join('')+'</div>'+
        '<div class="cp-shot-scenarios"><article><b>سناریوی صعودی</b><p>'+esc(a.bullishScenario||'شواهد کافی دیده نشد.')+'</p></article><article><b>سناریوی نزولی</b><p>'+esc(a.bearishScenario||'شواهد کافی دیده نشد.')+'</p></article></div>'+
        '<div class="cp-shot-watch"><b>برای تصمیم بهتر چه چیزی را زیر نظر بگیری؟</b><p>'+esc(a.watch||'ساختار قیمت، حجم و تأیید تایم‌فریم بالاتر را بررسی کن.')+'</p></div>'+
        '<div class="cp-ai-foot">تحلیل آموزشی است و تضمین سود یا توصیه مالی شخصی نیست.</div></div>';
      box.querySelectorAll('.cp-shot-marker').forEach(m=>m.onclick=()=>{const card=box.querySelector('[data-point-card="'+m.dataset.point+'"]');card?.scrollIntoView({behavior:'smooth',block:'center'});box.querySelectorAll('.cp-shot-point').forEach(x=>x.classList.remove('active'));card?.classList.add('active')});
      box.querySelectorAll('.cp-shot-point').forEach(card=>card.onclick=()=>box.querySelector('.cp-shot-marker[data-point="'+card.dataset.pointCard+'"]')?.focus());
    };
    (async()=>{
      try{
        const r=await fetch('/api/me',{cache:'no-store'});if(!r.ok)throw Error('free');
        const j=await r.json(),premium=j.user?.plan==='premium';
        if(!premium)throw Error('free');
        $('cpShotCtaTitle').textContent='Premium active — ready';
        $('cpShotCtaSub').textContent='تصویر را ارسال کن تا تحلیل بصری، نقاط مهم و توضیح کاربردی ساخته شود.';
        btn.textContent='Analyze Screenshot';
        btn.onclick=async()=>{
          const file=$('cpShotFile').files?.[0];if(!file)return;
          if(file.size>8*1024*1024){ans.innerHTML='<div class="cp-ai-answer-loading">حجم تصویر باید کمتر از 8MB باشد.</div>';return;}
          btn.disabled=true;ans.innerHTML='<div class="cp-ai-answer-loading">در حال خواندن ساختار چارت و علامت‌گذاری نقاط مهم روی تصویر…</div>';
          try{
            const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file)});
            const symbol=(sel.value||'BTC').toUpperCase()+'USDT';
            const rr=await fetch('/api/ai/screenshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,image:data})});
            const jj=await rr.json();if(!rr.ok||!jj.ok)throw Error(jj.error||'screenshot');
            renderAnalysis(jj,symbol,data);
          }catch(e){ans.innerHTML='<div class="cp-ai-answer-loading">تحلیل تصویری انجام نشد. دوباره با تصویر واضح‌تر امتحان کن.</div>'}
          finally{btn.disabled=false;}
        };
      }catch{
        $('cpShotCtaTitle').textContent='Unlock Screenshot AI';
        $('cpShotCtaSub').textContent='علامت‌گذاری روی تصویر، توضیح نقاط، سناریوها و چک‌لیست ریسک با Premium باز می‌شود.';
        btn.textContent='Unlock Premium';
        btn.onclick=()=>{location.href='/payment.html'};
      }
    })();
  }
  async function run(force=false){
    const k=key();if(!force&&k===lastKey&&$('cpAiDeep')?.dataset.loaded==='1')return;lastKey=k;
    css();let root=$('cpAiDeep');if(!root){const grid=document.querySelector('.aiGrid');if(!grid)return;grid.insertAdjacentHTML('beforebegin',`<div id="cpAiDeep" class="cp-ai-deep"><div class="cp-ai-body"><div class="cp-ai-loading">Analyzing the asset and chart structure…</div></div></div>`);root=$('cpAiDeep')}else root.innerHTML='<div class="cp-ai-body"><div class="cp-ai-loading">Analyzing the asset and chart structure…</div></div>';
    screenshotPanel();
    try{const q=new URLSearchParams(location.search),symbol=(q.get('symbol')||'BTCUSDT').toUpperCase(),tf=q.get('tf')||'1h';const r=await fetch(`/api/ai/chart-analysis?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&_=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'ai');root.dataset.loaded='1';render(j);}
    catch{root.innerHTML='<div class="cp-ai-body"><div class="cp-ai-loading">AI Analysis is temporarily unavailable; live chart data remains active.</div></div>';root.dataset.loaded='0';}
  }
  function wire(){const coin=$('coin');coin?.addEventListener('change',()=>setTimeout(()=>run(true),120));document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>run(true),120)));run(true);if(timer)clearInterval(timer);timer=setInterval(()=>run(true),90000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();