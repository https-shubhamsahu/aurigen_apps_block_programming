// PM2 process file — keeps the API and the compile worker running as
// separate processes, restarts them on crash, and survives reboots
// once `pm2 startup` + `pm2 save` have been run (see install.sh).
// NOTE: .cjs on purpose — pm2 loads ecosystem files via require(), which
// the backend's "type": "module" package.json would otherwise break.
module.exports = {
  apps: [
    // .env is loaded by the apps themselves (process.loadEnvFile in
    // server.js/worker.js) — pm2 has no env_file option.
    {
      name: 'aurigen-api',
      script: 'server.js',
      cwd: __dirname,
      max_memory_restart: '300M',
      restart_delay: 2000,
    },
    {
      name: 'aurigen-worker',
      script: 'worker.js',
      cwd: __dirname,
      // arduino-cli compiles are memory-hungry; give the worker more
      // headroom than the API before pm2 restarts it.
      max_memory_restart: '700M',
      restart_delay: 2000,
    },
  ],
};
