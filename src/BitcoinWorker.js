'use strict'
const { Worker } = require('blocktank-worker')
const BtcNode = require('./Bitcoin')
const workerConfig = require('../config/worker.config.json')

const privates = [
  'constructor'
]

class BitcoinWorker extends Worker {
  constructor (config) {
    super({
      name: config.svc_name || 'svc:btc',
      port: config.port || 5833
    })
    this.btc = new BtcNode(workerConfig)
  }

  start () {
    this.btc.getHeight(null, (err, data) => {
      if (err) throw err
      if (!Number.isInteger(data)) throw new Error('Node not ready')
      Object.getOwnPropertyNames(Object.getPrototypeOf(this.btc))
        .filter((n) => !privates.includes(n.toLowerCase()))
        .forEach((n) => {
          this[n] = this._handler.bind(this, n)
        })
    })
  }

  _handler (action, args, cb) {
    if (!Array.isArray(args)) {
      args = [args]
    }
    if (!args.push) {
      throw new Error('Invalid params passed:')
    }
    args.push(cb)
    this.btc[action].apply(this.btc, args)
  }
}

module.exports = BitcoinWorker
