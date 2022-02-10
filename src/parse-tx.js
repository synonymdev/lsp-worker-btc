'use strict'

const { get } = require('lodash')

module.exports = {
  getDestinationAddr: (vout) => {
    return get(vout, 'scriptPubKey.address', null) || get(vout, 'scriptPubKey.addresses', ['']).pop()
  },
  isCoinbase: (tx) => {
    if (tx.vin[0].coinbase) return true
    return false
  }
}
