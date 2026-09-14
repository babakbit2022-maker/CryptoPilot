import fs from 'node:fs';

const root = process.cwd();
const serverPath = `${root}/server.js`;
const chartPath = `${root}/public/crypto-chart.html`;
const wallet = 'TLSqNCn8Jdsh6eV4kty3sdeWhcpJFPeVS5';

let server = fs.readFileSync(serverPath, 'utf8');
const beforeWalletCount = (server.match(new RegExp(wallet, 'g')) || []).length;

const tableMarker = "CREATE TABLE IF NOT EXISTS ai_predictions(";
if (!server.includes(tableMarker)) {
  const needle = "CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,meta TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);";
  if (!server.includes(needle)) throw new Error('AI memory table insertion point not found');
  server = server.replace(needle, `${needle}\nCREATE TABLE IF NOT EXISTS ai_predictions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,symbol TEXT NOT NULL,tf TEXT NOT NULL,bias TEXT NOT NULL,entry REAL,stop REAL,tp1 REAL,tp2 REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,status TEXT NOT NULL DEFAULT 'pending',outcome TEXT,source TEXT DEFAULT 'live',FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL);\nCREATE INDEX IF NOT EXISTS idx_ai_predictions_market ON ai_predictions(symbol,tf,created_at);`);
}

const helperMarker = 'function aiMemoryBias(a){';
if (!server.includes(helperMarker)) {
  const needle = "function audit(userId, action, meta={}) { db.prepare('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)').run(userId || null, action, JSON.stringify(meta)); }";
  if (!server.includes(needle)) throw new Error('AI memory helper insertion point not found');
  const helpers = `${needle}\nfunction aiMemoryBias(a){if(!a)return 'NEUTRAL';if(a.setup==='BULLISH_SETUP')return 'LONG';if(a.setup==='BEARISH_SETUP')return 'SHORT';return Number(a.bullScore||0)>Number(a.bearScore||0)?'LONG':Number(a.bearScore||0)>Number(a.bullScore||0)?'SHORT':'NEUTRAL';}\nfunction aiMemoryEvaluate(rows,currentPrice){for(const p of rows){if(p.status!=='pending')continue;const px=Number(currentPrice);const entry=Number(p.entry),stop=Number(p.stop),tp1=Number(p.tp1);if(!Number.isFinite(px)||!Number.isFinite(entry)||!Number.isFinite(stop)||!Number.isFinite(tp1))continue;let outcome=null;if(p.bias==='LONG'){if(px>=tp1)outcome='TP1_HIT';else if(px<=stop)outcome='STOP_HIT';}else if(p.bias==='SHORT'){if(px<=tp1)outcome='TP1_HIT';else if(px>=stop)outcome='STOP_HIT';}if(outcome){db.prepare("UPDATE ai_predictions SET status='resolved',outcome=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(outcome,p.id);}}}\nfunction aiMemorySummary(symbol,tf){const rows=db.prepare("SELECT * FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);const resolved=rows.filter(x=>x.status==='resolved');const wins=resolved.filter(x=>x.outcome==='TP1_HIT').length;return {total:rows.length,resolved:resolved.length,wins,accuracy:resolved.length?Math.round(wins/resolved.length*100):null,pending:rows.length-resolved.length,last:rows[0]||null};}`;
  server = server.replace(needle, helpers);
}

const routesMarker = "app.get('/api/market-status',";
if (!server.includes("app.post('/api/ai-memory/snapshot'")) {
  const routes = `app.post('/api/ai-memory/snapshot',async(req,res)=>{try{const symbol=String(req.body?.symbol||'').toUpperCase(),tf=String(req.body?.tf||'1h');if(!tfMap[tf])return res.status(400).json({error:'unsupported_tf'});await refreshMarketUniverse();if(!symbols[symbol])return res.status(400).json({error:'unsupported_market'});const j=await getAnalysis(symbol,tf),a=j.analysis,bias=aiMemoryBias(a);const nowCut=new Date(Date.now()-30*60*1000).toISOString();const recent=db.prepare("SELECT id FROM ai_predictions WHERE symbol=? AND tf=? AND created_at>=? ORDER BY created_at DESC LIMIT 1").get(symbol,tf,nowCut);if(!recent){const levels=bias==='SHORT'?a.tradeLevels?.short:a.tradeLevels?.long;db.prepare('INSERT INTO ai_predictions(user_id,symbol,tf,bias,entry,stop,tp1,tp2,source) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user?.id||null,symbol,tf,bias,levels?.entry??a.price,levels?.stop??null,levels?.tp1??null,levels?.tp2??null,'live');}res.json({ok:true,summary:aiMemorySummary(symbol,tf)});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});\napp.get('/api/ai-memory/summary',async(req,res)=>{try{const symbol=String(req.query.symbol||'').toUpperCase(),tf=String(req.query.tf||'1h');if(!tfMap[tf]||!symbols[symbol])return res.status(400).json({error:'invalid_market'});const j=await getAnalysis(symbol,tf);const rows=db.prepare("SELECT * FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);aiMemoryEvaluate(rows,j.analysis?.price);const summary=aiMemorySummary(symbol,tf);if(req.user?.plan==='premium')return res.json({ok:true,premium:true,summary,history:db.prepare("SELECT id,symbol,tf,bias,entry,stop,tp1,tp2,created_at,resolved_at,status,outcome FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf)});return res.json({ok:true,premium:false,summary:{total:summary.total,resolved:summary.resolved,wins:summary.wins,accuracy:summary.accuracy,pending:summary.pending,last:summary.last?{bias:summary.last.bias,created_at:summary.last.created_at,status:summary.last.status}:null}});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});\napp.get('/api/ai-memory/history',auth,premium,async(req,res)=>{try{const symbol=String(req.query.symbol||'').toUpperCase(),tf=String(req.query.tf||'1h');const rows=db.prepare("SELECT id,symbol,tf,bias,entry,stop,tp1,tp2,created_at,resolved_at,status,outcome FROM ai_predictions WHERE symbol=? AND tf=? ORDER BY created_at DESC LIMIT 30").all(symbol,tf);res.json({ok:true,history:rows});}catch{res.status(503).json({error:'ai_memory_unavailable'});}});\n`;
  if (!server.includes(routesMarker)) throw new Error('AI memory route insertion point not found');
  server = server.replace(routesMarker, routes + routesMarker);
}

const afterWalletCount = (server.match(new RegExp(wallet, 'g')) || []).length;
if (beforeWalletCount !== afterWalletCount) throw new Error('Protected wallet reference changed');
fs.writeFileSync(serverPath, server);

let chart = fs.readFileSync(chartPath, 'utf8');
if (!chart.includes('/ai-memory.js')) {
  const needle = '<script src="/ai-analyst.js" defer></script>';
  if (!chart.includes(needle)) throw new Error('Chart AI script marker not found');
  chart = chart.replace(needle, `${needle}<script src="/ai-memory.js" defer></script>`);
  fs.writeFileSync(chartPath, chart);
}
console.log('AI Market Memory upgrade applied safely.');
