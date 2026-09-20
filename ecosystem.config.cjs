module.exports = {
  apps: [{
    name: 'cryptopilot',
    script: 'bootstrap.js',
    cwd: '/opt/cryptopilot',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '700M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      ...(process.env.PAYMENT_WALLET ? { PAYMENT_WALLET: process.env.PAYMENT_WALLET } : {}),
      ...(process.env.PREMIUM_PRICE_USDT ? { PREMIUM_PRICE_USDT: process.env.PREMIUM_PRICE_USDT } : {}),
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.OPENAI_MODEL ? { OPENAI_MODEL: process.env.OPENAI_MODEL } : {}),
      ...(process.env.OPENAI_VISION_MODEL ? { OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL } : {}),
      ...(process.env.TRUST_PROXY ? { TRUST_PROXY: process.env.TRUST_PROXY } : {}),
      ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
      ...(process.env.CMC_API_KEY ? { CMC_API_KEY: process.env.CMC_API_KEY } : {})
    }
  }]
};
