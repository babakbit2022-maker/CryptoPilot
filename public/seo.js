/* Lightweight metadata layer for crawlable market/analysis pages. */
(()=>{
  const p=location.pathname;
  const q=new URLSearchParams(location.search);
  const raw=(q.get('symbol')||'BTCUSDT').toUpperCase();
  const symbol=raw.replace(/USDT$/,'')||'BTC';
  const names={BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',BNB:'BNB',XRP:'XRP',DOGE:'Dogecoin',ADA:'Cardano',AVAX:'Avalanche',LINK:'Chainlink',DOT:'Polkadot',LTC:'Litecoin',TRX:'TRON'};
  const name=names[symbol]||symbol;
  if(p.endsWith('/crypto-chart.html')){
    const title=`${name} (${symbol}) Live Chart & Technical Analysis | CryptoPilot AI`;
    const description=`Live ${name} price, candlestick chart, technical indicators, market risk and AI market analysis for ${symbol}.`;
    document.title=title;
    const set=(sel,attr,val)=>{let e=document.querySelector(sel);if(!e){e=document.createElement('meta');document.head.appendChild(e)}e.setAttribute(attr,val)};
    set('meta[name="description"]','name',description);document.querySelector('meta[name="description"]').content=description;
    set('meta[property="og:title"]','property',title);document.querySelector('meta[property="og:title"]').content=title;
    set('meta[property="og:description"]','property',description);document.querySelector('meta[property="og:description"]').content=description;
    set('meta[name="twitter:card"]','name','summary');
    let c=document.querySelector('link[rel="canonical"]');if(!c){c=document.createElement('link');c.rel='canonical';document.head.appendChild(c)}c.href=location.origin+`/crypto-chart.html?symbol=${encodeURIComponent(symbol+'USDT')}&tf=1h`;
    const ld=document.createElement('script');ld.type='application/ld+json';ld.textContent=JSON.stringify({'@context':'https://schema.org','@type':'WebApplication','name':title,'applicationCategory':'FinanceApplication','description':description,'url':c.href});document.head.appendChild(ld);
  }
})();
