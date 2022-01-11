'use strict'
const BtcWorker = require('./src/BitcoinWorker')
const btc = new BtcWorker({})
btc.start()

const Mempool = require('./src/Mempool')
const mempool = new Mempool({
  port: 5834,
  svc_name: 'svc:btc:mempool'
})
mempool.start()

const Blocks = require('./src/Blocks')
const blocks = new Blocks({
  port: 5835,
  svc_name: 'svc:btc:blocks'
})
blocks.start()
