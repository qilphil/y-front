module.exports = {
  apps: [{
    name:        'y-front',
    script:      'src/server.js',
    cwd:         '/home/p/dev/y-front',
    instances:   1,
    exec_mode:   'fork',
    autorestart: true,
    watch:       false,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
