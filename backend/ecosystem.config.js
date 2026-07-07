// PM2 process file — keeps the API and the compile worker running as
// separate processes, restarts them on crash, and survives reboots
// once `pm2 startup` + `pm2 save` have been run (see install.sh).
export default {
  apps: [
    {
      name: 'aurigen-api',
      script: 'server.js',
      cwd: import.meta.dirname,
      env_file: '.env',
      max_memory_restart: '300M',
      restart_delay: 2000,
    },
    {
      name: 'aurigen-worker',
      script: 'worker.js',
      cwd: import.meta.dirname,
      env_file: '.env',
      // arduino-cli compiles are memory-hungry; give the worker more
      // headroom than the API before pm2 restarts it.
      max_memory_restart: '700M',
      restart_delay: 2000,
    },
  ],
};
