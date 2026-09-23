import crypto from 'node:crypto';

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const API_BASE = String(process.env.CRYPTOPILOT_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/$/,'');
const PUBLIC_BASE = String(process.env.CRYPTOPILOT_PUBLIC_URL || 'http://87.107.190.74').replace(/\/$/,'');
const POLL_TIMEOUT = 25;

function tg(method, body = {}) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000)
  }).then(async r => {
    const j = await r.json().catch(()=>({}));
    if (!r.ok || !j.ok) throw new Error(j.description || `Telegram HTTP ${r.status}`);
    return j.result;
  });
}

async function cp(path, options = {}) {
  const r = await fetch(API_BASE + path, {cache:'no-store', ...options, signal: AbortSignal.timeout(15000)});
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `CryptoPilot HTTP ${r.status}`), {status:r.status, data:j});
  return j;
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const num = (v, d=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined,{maximumFractionDigits:d}) : '—';
const pct = v => Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}%` : '—';

async function send(chatId, text, extra={}) {
  return tg('sendMessage', {chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra});
}

async function handleMessage(m) {
  const chatId = m.chat?.id;
  if (!chatId) return;
  const text = String(m.text || '').trim();
  const command = (text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?/)?.[1] || '').toLowerCase();
  const arg = text.replace(/^\/\w+(?:@\w+)?\s*/,'').trim().toUpperCase();

  if (m.photo?.length) return handlePhoto(m, chatId);

  if (command === 'start') {
    return send(chatId,
      '<b>🚀 CryptoPilot AI</b>\n\n' +
      'Live crypto intelligence مستقیم از موتور CryptoPilot.\n\n' +
      '📊 /market — بازار زنده\n' +
      '🚀 /gainers — بیشترین رشد\n' +
      '⚠️ /risk — ریسک بازار\n' +
      '🤖 /picks — Daily AI Picks\n' +
      '🔎 /coin BTC — اطلاعات یک ارز\n' +
      '📈 /analysis BTC — تحلیل بازار\n' +
      '💎 /premium — فعال‌سازی Premium\n' +
      '📷 یک اسکرین‌شات چارت بفرست — تحلیل AI\n\n' +
      '<i>این سرویس اطلاعات و تحلیل آموزشی ارائه می‌کند و تضمین سود نیست.</i>');
  }

  if (command === 'help') return handleMessage({chat:m.chat, text:'/start'});
  if (command === 'market') {
    const d = await cp('/api/coins');
    const rows = (d.coins || d.data || d || []).slice(0,10);
    return send(chatId, '<b>📊 CryptoPilot Live Market</b>\n\n' + rows.map((x,i)=>
      `${i+1}. <b>${esc(x.symbol || x.name || '—')}</b>  ${num(x.price)}  <b>${pct(x.change24h)}</b>`
    ).join('\n') + `\n\n<a href="${PUBLIC_BASE}/markets.html">مشاهده بازار کامل</a>`);
  }

  if (command === 'gainers') {
    const d = await cp('/api/top-gainers');
    const rows = d.gainers || d.results || d.data || [];
    if (!rows.length) return send(chatId,'⚠️ در حال حاضر داده معتبر Top Gainers از منبع بازار دریافت نشد.');
    return send(chatId, '<b>🚀 Highest Growth Now</b>\n\n' + rows.slice(0,10).map((x,i)=>
      `${i+1}. <b>${esc(x.symbol || x.name || '—')}</b>  ${pct(x.change24h ?? x.change)}`
    ).join('\n'));
  }

  if (command === 'risk') {
    const d = await cp('/api/market-stats');
    return send(chatId, '<b>⚠️ Market Risk</b>\n\n' +
      `Market Cap: <b>$${num(d.marketCap,0)}</b>\n` +
      `24h Volume: <b>$${num(d.volume24h,0)}</b>\n` +
      `BTC Dominance: <b>${num(d.btcDominance)}%</b>`);
  }

  if (command === 'picks') {
    try {
      const d = await cp('/api/daily-picks');
      const rows = d.picks || d.daily_picks || d.data || [];
      if (!rows.length) throw new Error('empty');
      return send(chatId, '<b>🤖 Daily AI Picks</b>\n\n' + rows.slice(0,5).map((x,i)=>
        `${i+1}. <b>${esc(x.symbol || x.coin || '—')}</b> · Score ${num(x.score)} · ${esc(x.confidence || '')}`
      ).join('\n') + '\n\n<i>تحلیل AI است، سیگنال تضمینی نیست.</i>');
    } catch {
      return send(chatId,'🔒 Daily AI Picks فعلاً در دسترس نیست. وضعیت موتور داده در حال بررسی است.');
    }
  }

  if (command === 'coin' || command === 'analysis') {
    const symbol = (arg || 'BTC').replace(/USDT$/,'');
    const d = await cp('/api/coins');
    const rows = d.coins || d.data || d || [];
    const x = rows.find(v => String(v.symbol || '').toUpperCase() === symbol);
    if (!x) return send(chatId,`❌ ارز ${esc(symbol)} در فهرست فعلی پیدا نشد.`);
    const chart = `${PUBLIC_BASE}/crypto-chart.html?symbol=${encodeURIComponent(symbol)}USDT&tf=1h`;
    return send(chatId,
      `<b>🔎 ${esc(x.name || symbol)} (${esc(symbol)})</b>\n\n` +
      `Price: <b>$${num(x.price,8)}</b>\n24h: <b>${pct(x.change24h)}</b>\nVolume: <b>$${num(x.volume24h,0)}</b>\nMarket Cap: <b>$${num(x.marketCap,0)}</b>\n\n` +
      `<a href="${chart}">📈 باز کردن چارت و تحلیل کامل</a>`);
  }

  if (command === 'premium') {
    const d = await cp('/api/payment/config');
    return send(chatId,
      '<b>💎 CryptoPilot Premium</b>\n\n' +
      `قیمت: <b>${num(d.amount,6)} USDT</b>\nشبکه: <b>TRC20</b>\n\n` +
      'برای حفظ امنیت، پرداخت و تأیید تراکنش از صفحه رسمی CryptoPilot انجام می‌شود.\n\n' +
      `<a href="${PUBLIC_BASE}/payment.html">💳 ورود به صفحه پرداخت و فعال‌سازی Premium</a>`);
  }

  if (command) return send(chatId,'دستور شناخته نشد. /help را بزن.');
}

async function handlePhoto(m, chatId) {
  try {
    await send(chatId,'📷 تصویر دریافت شد. در حال ارسال برای تحلیل AI...');
    const best = m.photo[m.photo.length-1];
    const f = await tg('getFile',{file_id:best.file_id});
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`,{signal:AbortSignal.timeout(20000)});
    if (!r.ok) throw new Error('telegram image download failed');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 7*1024*1024) throw new Error('image too large');
    const mime = String(f.file_path||'').toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    const image = `data:image/${mime};base64,${buf.toString('base64')}`;
    const d = await cp('/api/ai/chart-analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image,timeframe:'15m'})});
    const a=d.analysis||{};
    return send(chatId,
      '<b>🤖 CryptoPilot AI Chart Analysis</b>\n\n' +
      `Trend: <b>${esc(a.trend||'Unknown')}</b>\nConfidence: <b>${esc(a.confidence||'Unknown')}</b>\nSupport: <b>${esc(a.support||'Unknown')}</b>\nResistance: <b>${esc(a.resistance||'Unknown')}</b>\nRisk: <b>${esc(a.risk||'Unknown')}</b>\nSetup: <b>${esc(a.setup||'Unknown')}</b>\n\n` +
      `${esc(a.summary||'No summary returned.')}\n\n<i>تحلیل صرفاً بر اساس تصویر ارسالی و برای اهداف آموزشی است.</i>`);
  } catch(e) {
    return send(chatId,'⚠️ تحلیل تصویر فعلاً انجام نشد. ممکن است موتور Vision یا داده بازار موقتاً در دسترس نباشد.');
  }
}

let offset = 0;
let running = false;

async function poll() {
  if (running) return;
  running = true;
  try {
    const updates = await tg('getUpdates',{offset,timeout:POLL_TIMEOUT,allowed_updates:['message']});
    for (const u of updates) {
      offset = Math.max(offset, Number(u.update_id)+1);
      try { await handleMessage(u.message || {}); } catch (e) {
        if (u.message?.chat?.id) await send(u.message.chat.id,'⚠️ سرویس موقتاً با خطا مواجه شد. دوباره تلاش کنید.');
        console.error('[CryptoPilot Telegram]', e.message);
      }
    }
  } catch(e) {
    console.error('[CryptoPilot Telegram poll]', e.message);
    await new Promise(r=>setTimeout(r,3000));
  } finally {
    running = false;
    if (TOKEN) setImmediate(poll);
  }
}

export async function startTelegramBot() {
  if (!TOKEN) {
    console.log('[CryptoPilot Telegram] TELEGRAM_BOT_TOKEN not configured; bot integration is installed but disabled.');
    return;
  }
  try {
    const me = await tg('getMe');
    console.log(`[CryptoPilot Telegram] connected as @${me.username || me.id}`);
    await tg('deleteWebhook',{drop_pending_updates:false});
    await tg('setMyCommands',{commands:[
      {command:'start',description:'شروع CryptoPilot AI'},
      {command:'market',description:'بازار زنده'},
      {command:'gainers',description:'بیشترین رشد'},
      {command:'risk',description:'ریسک بازار'},
      {command:'picks',description:'Daily AI Picks'},
      {command:'coin',description:'اطلاعات ارز، مثال: /coin BTC'},
      {command:'analysis',description:'تحلیل ارز، مثال: /analysis BTC'},
      {command:'premium',description:'Premium و پرداخت USDT TRC20'},
      {command:'help',description:'راهنما'}
    ]});
    poll();
  } catch(e) {
    console.error('[CryptoPilot Telegram] startup failed:', e.message);
  }
}
