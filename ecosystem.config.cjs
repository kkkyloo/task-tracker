module.exports = {
  apps: [
    {
      name: 'max-bot',
      script: 'bot.mjs',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 1000,            // фактически без лимита для редких обрывов
      min_uptime: 10000,             // если продержался 10с — считается стабильным, счётчик сброшен
      restart_delay: 3000,
      exp_backoff_restart_delay: 5000, // нарастающая задержка при серии падений (напр. MAX API лежит)
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/max-bot-error.log',
      out_file: './logs/max-bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
