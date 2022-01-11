'use strict'
const BtcWorker = require('./src/BitcoinWorker')
const btc = new BtcWorker({})
btc.start()
