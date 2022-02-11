'use strict'

const DEBUG_FLAG = 'LH:*'

const settings = {
  ignore_watch: 'status',
  watch: ['./src', './*js'],
  namespace: 'workers-bitcoin'
}

module.exports = {
  apps: [
    {
      name: 'btc:worker',
      script: './start.bitcoin.js',
      env: {
        DEBUG: DEBUG_FLAG
      },
      env_production: {},
      ...settings
    },
    {
      name: 'btc:worker:mempool',
      script: './start.mempool.js',
      env: {
        DEBUG: DEBUG_FLAG
      },
      env_production: {},
      ...settings
    },
    {
      name: 'btc:worker:blocks',
      script: './start.blocks.js',
      env: {
        DEBUG: DEBUG_FLAG
      },
      env_production: {},
      ...settings
    }
  ]
}
