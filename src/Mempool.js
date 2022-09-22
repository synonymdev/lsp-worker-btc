'use strict'
const path = require('path')
const _ = require('lodash')
const async = require('async')
const BN = require('bignumber.js')
const { default: axios } = require('axios')
const Worker = require('./BitcoinWorker')
const { toSatoshi } = require('./sats-convert')
const Cache = require('./Cache')
const mempoolConfig = require('../config/mempool.worker.config.json')

async function mempoolProvider () {
  try {
    const res = await axios.get('https://mempool.space/api/v1/fees/recommended')
    return _.get(res, 'data.fastestFee', null)
  } catch (err) {
    console.log('Mempool fee provider is down')
    throw new Error('TX_FEE_PROVIDER_DOWN')
  }
}

// TODO: Use Zeromq stream instead of polling getrawmempool
class Mempool extends Worker {
  constructor (config) {
    super(config)
    this.statusFile = path.join(__dirname, '../status/mempool.json')
    this.current_height = null
    this.mempoolCache = new Cache()
  }

  getCurrrentFeeThreshold (args, cb) {
    return cb(null, {
      min_fee: this.min_fee,
      min_fee_expiry: this.min_fee_expiry
    })
  }

  updateHeight (cb) {
    this._getCurrentHeight((err, height) => {
      if (err) {
        this.alertSlack('error', 'Unable to fetch latest block from Bitcoin node.')
        return
      }
      if (!this.current_height || height > this.current_height) {
        this.current_height = height
      }
      if (cb) { cb(null, height) }
    })
  }

  _getCurrentHeight (args, cb) {
    if (cb) {
      return this.callBtcBlocks('getCurrentBlock', args, cb)
    }
    return this.callBtcBlocks('getCurrentBlock', {}, args)
  }

  publishNewTx (data) {
    // send messages about new tx
    mempoolConfig.new_transactions.forEach((svc) => {
      this.gClient.send(svc, {
        method: 'mempoolNewTransactions',
        args: [data]
      })
    })
  }

  getMempoolTx (filter, cb) {
    if (!this.min_fee) {
      console.log('Minimum fee is not set, aborting')
      return cb(null, [])
    }

    if (this._mempool_running) {
      console.log('warning', 'Mempool parser taking too long.')
      return cb(null, [])
    }

    const filterAddr = filter.address

    if (filterAddr.length === 0) {
      return cb(null, [])
    }

    console.log('Filtering mempool for ', filterAddr.length)
    this._mempool_running = true
    async.waterfall([
      async () => this.btc.getOptimisedMempool({ verbose: true }),
      (mempool, next) => {
        this._getCurrentHeight((err, height) => {
          if (err) return next(err)
          next(null, { mempool, height })
        })
      },
      async ({ mempool, height }, next) => {
        const mempoolTx = []

        for (const txid in mempool) {
          if (this.mempoolCache.exists(txid)) continue
          this.mempoolCache.add(txid)
          const tx = mempool[txid]
          const satVbyte = new BN(toSatoshi(tx.fee)).dividedToIntegerBy(tx.vsize)
          if (!satVbyte.isInteger()) {
            throw new Error('Failed to calculate SatVbyte')
          }
          const zeroConfTx = [
            // We do not accept transactions older than current block
            tx.height === height,
            // UTXO must not depend on previous tx
            tx.depends.length === 0,
            // TX must not be already spent
            tx.spentby.length === 0,
            // Do not accept RBF (Replace by fee)
            tx['bip125-replaceable'] === false,
            // Minimum Fee must be spent
            satVbyte.gte(this.min_fee)
          ].includes(false)
          tx._txid = txid
          tx.zero_conf = !zeroConfTx
          mempoolTx.push(tx)
        }
        console.log(`Filtered tx: ${mempoolTx.length}`)
        return mempoolTx
      },
      async (txs) => {
        const data = await async.mapLimit(txs, 2, async ({ _txid: id, zero_conf: zeroConf, fee }) => {
          if (filterAddr.length === 0) return null
          const tx = (await this.btc.parseTransaction({ height: 'SKIP', id }))
            .map((tx) => {
              const index = filterAddr.indexOf(tx[1].to)
              if (index > -1) {
                filterAddr.splice(index, 1)
                tx[1].zero_conf = zeroConf
                tx[1].fee_base = toSatoshi(fee)
                return tx
              }
              return null
            }).filter(Boolean)
          if (tx.length === 0) return null
          return this.btc.processSender(tx, true)
        })
        if (!data || data.length === 0) return []
        return data.flat().filter(Boolean)
      }
    ], (err, data) => {
      this._mempool_running = false
      if (err) {
        console.log('Error Parsing Mempool', err)
        // this.alertSlack('error', 'Unable to fetch mempool tx')
        return
      }
      console.log(`Filtered Mempool tx count: ${data.length}`)
      cb(null, data)
    })
  }

  async updateMinFee () {
    this.updateHeight()
    let fee
    try {
      fee = await mempoolProvider()
    } catch (err) {
      // this.alertSlack('error', 'Mempool fee provider down.')
      fee = null
    }

    if (!fee) {
      this.min_fee = null
      return
    }
    this.min_fee = fee
    this.min_fee_expiry = Date.now() + mempoolConfig.quote_expiry
  }

  getTransaction ({ txid }) {
    return this.btc.getTransaction(txid)
  }

  start () {
    super.start()
    this.updateMinFee()
    this.fee_timer = setInterval(() => {
      this.updateMinFee()
    }, mempoolConfig.quote_expiry)
  }
}

module.exports = Mempool
