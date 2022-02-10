'use strict'
const axios = require('axios')
const { get } = require('lodash')
const BitcoinDB = require('./BitcoinDb')

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
        true, // subtractfeefromamount
        true, // replaceable
        1 //  target bloc
      ])
    } catch (err) {
      console.log(err)
      return cb(err)
    }

    this.db.saveTx({
      to: args.address,
      amount: args.amount,
      tag: args.tag,
      txid: send
    }, (err, data) => {
      if (err) {
        return cb(new Error(`Failed to save tx: ${send}`))
      }
      cb(null, { txid: send })
    })
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
}
  