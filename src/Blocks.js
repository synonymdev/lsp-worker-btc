'use strict'
const async = require('async')
const BitcoinWorker = require('./BitcoinWorker')
const { StatusFile } = require('blocktank-worker')
const blockConfig = require('../config/blocks.worker.config.json')

class BlockProcessor extends BitcoinWorker {
  constructor (config) {
    super(config)
    this.block_time = config.block_time || 5000
    this.min_confirmation = config.min_confirmation
    this._block_processor = false
    this.statusFile = new StatusFile({
      tag: 'bitcoin',
      postfix: 'blocks'
    })
  }

  async _loadState () {
    let f
    try {
      f = await this.statusFile.loadFile()
      this.current_height = f.current_height
      console.log(`Current loaded block: ${f.current_height}`)
      return
    } catch (err) {
      console.log(`Creating ${this.statusFile}`)
      await this._updateStatusFile(0)
    }
  }

  publishNewBlock (data) {
    // send messages about new block
    console.log('Current block: ', data)
    blockConfig.new_block_listeners.forEach((svc) => {
      this.gClient.send(svc, {
        method: 'onNewBlock',
        args: [data]
      })
    })
  }

  _updateStatusFile (h) {
    return this.statusFile.updateFile({ current_height: h })
  }

  getCurrentBlock (options, cb) {
    if (!this.current_height) {
      return cb(new Error('Current block height is unkown'))
    }
    cb(null, this.current_height || null)
  }

  setHeightToLatestBlock (args, cb) {
    this.pause_timer = true
    this.btc.getHeight({}, (err, height) => {
      if (err) throw err
      this.current_height = height
      this._updateStatusFile(this.current_height)
      //this.publishNewBlock(this.current_height)
      this.pause_timer = false
      cb()
    })
  }

  updateHeight () {
    if(this.pause_timer) return 
    this.btc.getHeight({}, (err, height) => {
      if (err) throw err
      if (height > this.current_height && !this._block_processor) {
        this.current_height = this.current_height + 1
        this._updateStatusFile(this.current_height)
        this.publishNewBlock(this.current_height)
      }
    })
  }

  async getHeightTransactions ({ height, address }, cb) {
    this._block_processor = true
    console.log('Getting transactions for block: ', height, 'Orders: ', address.length)
    console.time('getHeightTransactions')
    const blockTx = await this.getBlockData({ height })
    return new Promise((resolve, reject) => {
      console.log(`Processing Block: ${height} : ${blockTx.tx.length} transactions`)
      async.mapLimit(blockTx.tx, 2, async (id) => {
        if (address.length === 0) return true
        const tx = (await this.btc.parseTransaction({ height, id }))
          .filter((tx) => {
            const index = address.indexOf(tx[1].to)
            if (index > -1) {
              address.splice(index, 1)
              return true
            }
            return false
          })
        if (tx.length === 0) return null
        return this.btc.processSender(tx, false)
      }, (err, data) => {
        console.timeEnd('getHeightTransactions')
        this._block_processor = false
        if (err) return cb(err)
        const tx = data.flat().filter(Boolean)
        this.btc.rawTxCache.clear()
        cb(null, tx)
      })
    })
  }

  async getBlockData ({ height }, cb) {
    const hash = await this.btc.getBlockHash(height)
    const block = await this.btc.getBlock(hash)
    return block
  }

  start () {
    super.start()
    this._loadState()
    this.timer = setInterval(() => {
      this.updateHeight()
    }, this.block_time)
  }
}

module.exports = BlockProcessor
