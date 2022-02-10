'use strict'

const Mempool = require('./src/Mempool')
const mempool = new Mempool({
  port: 5834,
  svc_name: 'svc:btc:mempool'
})
mempool.start()
