// PM2 部署（非 Docker）：pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'wanderlust-api',
    script: 'src/index.mjs',
    instances: 1,            // 单实例：状态机/账本依赖 DB 行锁，扩容前先做幂等压测
    env: { NODE_ENV: 'production' },
    max_memory_restart: '300M',
  }, {
    name: 'wanderlust-jobs',
    script: 'src/jobs.mjs',
    instances: 1,
    env: { NODE_ENV: 'production' },
    max_memory_restart: '200M',
  }],
}
