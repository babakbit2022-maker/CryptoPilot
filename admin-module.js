import { readFile } from 'node:fs/promises';

export function installAdminRoutes(app, db, adminUser) {
  const guard = (req,res,next) => {
    const u = adminUser(req);
    if (!u) return res.status(403).json({error:'admin_required'});
    req.admin = u;
    next();
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS support_messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      replied_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_messages_status ON support_messages(status);
  `);

  app.get('/admin', async (req,res) => {
    try {
      const html = await readFile(new URL('./public/admin.html', import.meta.url), 'utf8');
      res.type('html').send(html);
    } catch { res.status(404).send('Admin console not installed'); }
  });

  app.get('/api/admin/dashboard', guard, (req,res) => {
    const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const premium = db.prepare("SELECT COUNT(*) c FROM users WHERE plan='premium'").get().c;
    const free = users - premium;
    const payments = db.prepare('SELECT COUNT(*) c FROM payment_orders').get().c;
    const pending = db.prepare("SELECT COUNT(*) c FROM payment_orders WHERE status='pending'").get().c;
    const confirmed = db.prepare("SELECT COUNT(*) c FROM payment_orders WHERE status='confirmed'").get().c;
    const messages = db.prepare("SELECT COUNT(*) c FROM support_messages WHERE status!='resolved'").get().c;
    const views = db.prepare("SELECT COUNT(*) c FROM page_views").get().c;
    const today = db.prepare("SELECT COUNT(*) c FROM page_views WHERE date(created_at)=date('now')").get().c;
    const signupsToday = db.prepare("SELECT COUNT(*) c FROM users WHERE date(created_at)=date('now')").get().c;
    res.json({ok:true,users,premium,free,payments,pending,confirmed,messages,views,viewsToday:today,signupsToday});
  });

  app.get('/api/admin/users', guard, (req,res) => {
    const q = String(req.query.q||'').trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit||100)));
    const rows = q
      ? db.prepare("SELECT id,email,plan,role,email_verified,created_at FROM users WHERE lower(email) LIKE ? ORDER BY id DESC LIMIT ?").all('%'+q+'%',limit)
      : db.prepare('SELECT id,email,plan,role,email_verified,created_at FROM users ORDER BY id DESC LIMIT ?').all(limit);
    res.json({ok:true,users:rows});
  });

  app.post('/api/admin/users/:id/premium', guard, (req,res) => {
    const id = Number(req.params.id);
    const action = req.body?.action === 'revoke' ? 'revoke' : 'grant';
    const duration = String(req.body?.duration||'lifetime');
    const reason = String(req.body?.reason||'Admin grant').slice(0,200);
    const u = db.prepare('SELECT id,email,plan FROM users WHERE id=?').get(id);
    if (!u) return res.status(404).json({error:'user_not_found'});
    db.prepare('UPDATE users SET plan=? WHERE id=?').run(action==='grant'?'premium':'free',id);
    db.prepare('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)').run(id,action==='grant'?'admin_grant_premium':'admin_revoke_premium',JSON.stringify({admin:req.admin.email,duration,reason}));
    res.json({ok:true,userId:id,plan:action==='grant'?'premium':'free'});
  });

  app.get('/api/admin/payments', guard, (req,res) => {
    const rows = db.prepare(`SELECT p.id,p.txid,p.status,p.created_at,p.user_id,u.email
      FROM payment_orders p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200`).all();
    res.json({ok:true,payments:rows});
  });

  app.post('/api/admin/payments/:id', guard, (req,res) => {
    const id = Number(req.params.id);
    const status = ['confirmed','rejected','pending'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({error:'invalid_status'});
    const p = db.prepare('SELECT id,user_id,txid FROM payment_orders WHERE id=?').get(id);
    if (!p) return res.status(404).json({error:'payment_not_found'});
    db.prepare('UPDATE payment_orders SET status=? WHERE id=?').run(status,id);
    if (status==='confirmed') db.prepare("UPDATE users SET plan='premium' WHERE id=?").run(p.user_id);
    if (status==='rejected') db.prepare("UPDATE users SET plan='free' WHERE id=?").run(p.user_id);
    db.prepare('INSERT INTO audit_log(user_id,action,meta) VALUES(?,?,?)').run(p.user_id,'admin_payment_'+status,JSON.stringify({admin:req.admin.email,paymentId:id,txid:p.txid}));
    res.json({ok:true,status});
  });

  app.get('/api/admin/messages', guard, (req,res) => {
    const rows = db.prepare(`SELECT m.*,u.email AS user_email FROM support_messages m
      LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200`).all();
    res.json({ok:true,messages:rows});
  });

  app.post('/api/admin/messages/:id/reply', guard, (req,res) => {
    const id = Number(req.params.id);
    const reply = String(req.body?.reply||'').trim().slice(0,5000);
    if (!reply) return res.status(400).json({error:'empty_reply'});
    const m = db.prepare('SELECT id FROM support_messages WHERE id=?').get(id);
    if (!m) return res.status(404).json({error:'message_not_found'});
    db.prepare("UPDATE support_messages SET admin_reply=?,status='resolved',replied_at=CURRENT_TIMESTAMP WHERE id=?").run(reply,id);
    res.json({ok:true});
  });

  app.get('/api/admin/analytics', guard, (req,res) => {
    const days = Math.min(90,Math.max(1,Number(req.query.days||30)));
    const daily = db.prepare(`SELECT substr(created_at,1,10) day,
      COUNT(*) views, COUNT(DISTINCT visitor_id) visitors
      FROM page_views WHERE created_at>=datetime('now',?) GROUP BY day ORDER BY day`).all('-'+(days-1)+' days');
    const signups = db.prepare(`SELECT substr(created_at,1,10) day,COUNT(*) count
      FROM users WHERE created_at>=datetime('now',?) GROUP BY day ORDER BY day`).all('-'+(days-1)+' days');
    res.json({ok:true,daily,signups});
  });

  app.get('/api/admin/audit', guard, (req,res) => {
    const rows = db.prepare(`SELECT a.*,u.email FROM audit_log a
      LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`).all();
    res.json({ok:true,audit:rows});
  });
}
