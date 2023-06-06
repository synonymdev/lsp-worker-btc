'use strict'
const axios = require('axios')
const { get } = require('lodash')
const BitcoinDB = require('./BitcoinDb')
const { toSatoshi } = require('./sats-convert')
const Cache = require('./Cache')
const { getDestinationAddr } = require('./parse-tx')
const async = require('async')

const promcb = (resolve, reject, cb) => {
  return (err, data) => {
    if (err) {
      return cb ? cb(err, data) : reject(err)
    }
    cb ? cb(err, data) : resolve(data)
  }
}

module.exports = class Bitcoin {
  constructor (config = {}) {
    this.config = config.bitcoin_node
    this.db = new BitcoinDB(config)
    this.rawTxCache = new Cache({ ttl: 5000 })
  }

  async _callApi (method, params, cb) {
    let res = {}
    try {
      res = await axios(this.config.url, {
        method: 'post',
        auth: {
          username: this.config.username,
          password: this.config.password
        },
        data: {
          jsonrpc: '2.0',
          id: 1,
          method,
          params
        }
      })
    } catch (err) {
      console.log(`Method called: ${method} - ${params}`)
      console.log(get(err, 'response.data', err))
      // console.log(err.response.data)
      if (cb) {
        return cb((err))
      }
    }
    const data = get(res, 'data.result')
    if (cb) {
      return cb(null, data)
    }
    return data
  }

  async getBlockchainInfo (args, cb) {
    try {
      const info = await this._callApi('getblockchaininfo', {})
      cb(null, info)
    } catch (err) {
      return cb(err)
    }
  }

  async getHeight (args, cb) {
    try {
      const info = await this._callApi('getblockchaininfo', {})
      cb(null, info.blocks)
    } catch (err) {
      return cb(err)
    }
  }

  async getMempool (options) {
    return this._callApi('getrawmempool', options || {})
  }

  // Transactions older than 5 mins are ignored
  async getOptimisedMempool (options) {
    const mempool = await this.getMempool(options)

    const data = {}
    const MIN_TIME = 600
    const now = Math.floor(Date.now() / 1000)
    for (const txid in mempool) {
      const tx = mempool[txid]
      const diff = now - tx.time
      if (diff > MIN_TIME) continue
      data[txid] = tx
    }
    return data
  }

  async createWallet (options, cb) {
    let wallet
    try {
      wallet = await this._callApi('createwallet', {
        wallet_name: options.wallet_name,
        load_on_startup: options.load_on_startup
      })
    } catch(err){
      cb(err)
    }
    cb(null, wallet)
  }

  async estimateSmartFee (options) {
    return this._callApi('estimatesmartfee', options)
  }

  async getRawTransaction ({ id }) {
    return this._callApi('getrawtransaction', [id, true])
  }

  decodeTxHex ({ hex }) {
    return this._callApi('decoderawtransaction', [hex])
  }

  async getNewAddress (args, cb) {
    if (!args.tag) return cb(new Error('Tag is missing'))
    const address = await this._callApi('getnewaddress', {})
    const privKey = await this._callApi('dumpprivkey', [address])
    this.db.saveAddress({
      address,
      private_key: privKey,
      tag: args.tag
    }, (err) => {
      if (err) {
        console.log(err)
        throw new Error('Unable to save private key')
      }
      cb(null, { address })
    })
  }

  getTransaction (args, cb) {
    return new Promise((resolve, reject) => {
      this._callApi('gettransaction', [args], promcb(resolve, reject, cb))
    })
  }

  async getBlockHash (args, cb) {
    return this._callApi('getblockhash', [+args])
  }

  async getBlock (args, cb) {
    return this._callApi('getblock', [args])
  }

  async sendToAddr (args, cb) {
    let send
    try {
      send = await this._callApi('sendtoaddress', [
        args.address,
        args.amount,
        args.tag,
        '', // comment_to
        false, // subtractfeefromamount
        args.replacable // replaceable
      ])
    } catch (err) {
      console.log(err)
      return cb(err)
    }
    cb(null, { txid: send })
  }

  async getWalletBalance (args, cb) {
    let bal

    try {
      bal = await this._callApi('getbalance', [])
    } catch (err) {
      return cb(err)
    }
    cb(null, { spendable_btc: bal })
  }

  async getBlockHeightOfTx ({ id }) {
    const block = await this.getBlock(id)
    return block.height ? block.height : null
  }

  async parseTransaction ({ height, id }) {
    let tx = this.rawTxCache.get(id)
    if (!tx) {
      tx = await this.getRawTransaction({ id })
    }
    if (!tx) return null
    if (!tx.vout) return null
    this.rawTxCache.add(id, tx)

    if (!height || height !== 'SKIP') {
      if (!tx.blockhash) {
        return []
      }
      height = await this.getBlockHeightOfTx({ id: tx.blockhash })
      if (!height) {
        return []
      }
    } else {
      height = null
    }

    return tx.vout
      .map((vout) => {
        const toAddr = getDestinationAddr(vout)
        if (!toAddr) return null
        return [tx, {
          height,
          hash: id,
          to: toAddr,
          amount_base: toSatoshi(vout.value)
        }]
      }).filter(Boolean)
  }

  async processSender (tx, mempoolTx) {
    return new Promise((resolve, reject) => {
      async.mapSeries(tx, async (data) => {
        if (!data) return null
        const [rawTx, parsedTx] = data
        if (!rawTx.vin) {
          parsedTx.from = null
          return parsedTx
        }
        const from = []
        await async.forEachLimit(rawTx.vin, 2, async (vin) => {
          if (vin.coinbase) return
          const tx = await this.parseTransaction({ height: mempoolTx ? 'SKIP' : null, id: vin.txid })
          if (!tx) return
          tx.forEach((d) => {
            if (!d || from.includes(d[1].to)) return
            from.push(d[1].to)
          })
        })
        parsedTx.from = from
        return parsedTx
      }, (err, data) => {
        if (err) return reject(err)
        resolve(data)
      })
    })
  }

  async mineRegtestCoin (args, cb) {
    
    if(args.address) {
      const block = await this._callApi('generatetoaddress', {
        address: args.address,
        nblocks: args.blocks
      })
      return cb(null, block)
    }
    
    this.getNewAddress({ tag: 'regtest_mine' }, async (err, { address }) => {
      if (err) return cb(err)
      const block = await this._callApi('generatetoaddress', {
        address,
        nblocks: args.blocks
      })
      cb(null, block)
    })
  }
}
