'use strict'
const Blocks = require('./src/Blocks')
const blocks = new Blocks({
  port: 5835,
  svc_name: 'svc:btc:blocks'
})
blocks.start()
