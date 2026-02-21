module.exports = {
  apps: [
    {
      name: 'clerky',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=lawyrs-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    },
    {
      name: 'crewai',
      script: 'python3',
      args: 'server.py',
      cwd: './crewai_backend',
      env: {
        CREWAI_PORT: 8100,
        PYTHONUNBUFFERED: '1'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000
    }
  ]
}
