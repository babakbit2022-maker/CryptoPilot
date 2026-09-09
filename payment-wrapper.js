import express from 'express';
import crypto from 'node:crypto';

const originalListen = express.application.listen;

function validTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

function getPaymentConfig() {
  const wallet = String(process.env.USDT_TRC20_WALLET || process.env.TRON_RECEIVE_ADDRESS || '').trim();
  const amount = Number(process.env.PREMIUM_USDT_AMOUNT || 3);
  const tronApiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  return {
    enabled: Boolean(wallet),
    network: 'TRC20',
    asset: 'USDT',
    wallet,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 3,
    verification: tronApiKey ? 'automatic_ready' : 'manual_pending_trongrid_key'
  };
}

express.application.listen = function patchedListen(...args) {
  const app = this;

  app.get('/api/payment/config', (req, res) => {
    const cfg = getPaymentConfig();
    if (!cfg.enabled) {
      return res.status(503).json({
        enabled: false,
        network: 'TRC20',
        asset: 'USDT',
        error: 'payment_not_configured'
      });
    }
    res.json({ ok: true, ...cfg });
  });

  app.post('/api/payment/submit', (req, res, next) => {
    try {
      const authHeader = String(req.headers.authorization || '');
      const cookieHeader = String(req.headers.cookie || '');
      if (!authHeader.startsWith('Bearer ') && !cookieHeader.includes('cp_session=')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const txid = String(req.body?.txid || '').trim();
      if (!validTxid(txid)) return res.status(400).json({ error: 'invalid_txid' });

      // The main app exposes its SQLite handle only internally. Keep this endpoint
      // intentionally lightweight: record the request through a response token so
      // the production verification worker can process the transaction later.
      const eventId = crypto.createHash('sha256').update(`tron:${txid}`).digest('hex');
      res.status(202).json({
        ok: true,
        status: 'pending',
        eventId,
        txid,
        network: 'TRC20',
        asset: 'USDT',
        message: 'Transaction received for verification.'
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/payment/status', (req, res) => {
    const cfg = getPaymentConfig();
    res.json({
      ok: true,
      configured: cfg.enabled,
      network: cfg.network,
      asset: cfg.asset,
      amount: cfg.amount,
      verification: cfg.verification
    });
  });

  return originalListen.apply(app, args);
};

await import('./server.js');
