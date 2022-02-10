'use strict'
const { DB } = require('blocktank-worker')

class BitcoinDb {
  constructor (params) {
    this.ready = false
    DB({ db_url: params.db_url }, (err, db) => {
      if (err) throw err
      this.db = db
      this.ready = true
    })
  }

  saveAddress (data, cb) {
    this.db.BtcAddress.insertOne({
      address: data.address,
      private_key: data.private_key,
      created_at: new Date(),
      tx: [],
      ...data
    }, cb)
  }
}
module.exports = BitcoinDb
