'use strict'
const path = require('path')
const _ = require('lodash')
const async = require('async')
const debug = require('debug')('LH:Mempool')
const BN = require('bignumber.js')
const { default: axios } = require('axios')
const Worker = require('./BitcoinWorker')
const { toSatoshi } = require('./sats-convert')
const { getDestinationAddr } = require('./parse-tx')
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

class Mempool extends Worker {
  constructor (config) {
    super(config)
    this.statusFile = path.join(__dirname, '../status/mempool.json')
    this.current_height = null
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

  checkMempool () {
    if (!this.min_fee) {
      debug('Minimum fee is not set, aborting')
      return
    }

    async.waterfall([
      async () => this.btc.getMempool({ verbose: true }),
      (mempool, next) => {
        this._getCurrentHeight((err, height) => {
          if (err) return next(err)
          next(null, { mempool, height })
        })
      },
      async ({ mempool, height }, next) => {
        const mempoolTx = []

        for (const txid in mempool) {
          const tx = mempool[txid]
          const satVbyte = new BN(toSatoshi(tx.fee)).dividedToIntegerBy(tx.vsize)
          if (!satVbyte.isInteger()) {
            return next(new Error('Failed to calculate SatVbyte'))
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
          if (!tx.zero_conf) continue
          const details = await this.btc.getRawTransaction({ id: tx._txid })
          mempoolTx.push({ mempool: tx, details })
        }
        return mempoolTx
      },
      async (txs) => {
        return txs.map(({ details, mempool }) => {
          return _.get(details, 'vout', []).map((vout) => {
            const toAddr = getDestinationAddr(vout)
            if (!toAddr) return null
            return {
              height: mempool.height,
              hash: details.txid,
              to: toAddr,
              amount_base: toSatoshi(vout.value),
              fee_base: toSatoshi(mempool.fee || 0),
              zero_conf: mempool.zero_conf
            }
          })
        }).flat().filter(Boolean)
      }
    ], (err, data) => {
      if (err) {
        debug('Error Parsing Mempool', err)
        this.alertSlack('error', 'Unable to fetch mempool tx')
        return
      }
      debug(`Mempool transaction count: ${data.length}`)
      this.publishNewTx(data)
    })
  }

  async updateMinFee () {
    this.updateHeight()
    let fee
    try {
      fee = await mempoolProvider()
    } catch (err) {
      this.alertSlack('error', 'Mempool fee provider down.')
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
    this.mempooltimer = setInterval(() => {
      this.checkMempool()
    }, mempoolConfig.mempool_timer)
  }
}

module.exports = Mempool
