'use strict'
const Server = require('./src/Worker')
const btc = new Server({})
btc.start()
