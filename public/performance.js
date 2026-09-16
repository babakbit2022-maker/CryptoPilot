/* CryptoPilot performance layer: keeps live screens responsive without changing visual design. */
(()=>{
  const isChart=location.pathname.endsWith('/crypto-chart.html');
  const isDashboard=location.pathname==='/'||location.pathname.endsWith('/index.html');
  // The chart already loads immediately. Re-fetching every 5s keeps the displayed market state fresh
  // while staying well below the server API rate limit. Abort stale requests so slow providers never pile up.
  if(isChart && typeof window.load==='function'){
    let busy=false;
    const tick=async()=>{ if(busy||document.visibilityState==='hidden') return; busy=true; try{ await Promise.resolve(window.load()); } finally { busy=false; } };
    setTimeout(tick,120);
    setInterval(tick,5000);
  }
  // When the dashboard tab is hidden, do not spend network requests on it. On return, refresh immediately.
  if(isDashboard){
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible' && typeof window.load==='function') setTimeout(()=>window.load(),50);
    });
  }
})();
