'use strict'

class Cache {
  constructor (config) {
    this.store = new Map()
    if (!config) config = {}

    const CACHE_CLEAR = config.ttl || 300000

    this.timer = setInterval(() => {
      this.store.forEach((v, k) => {
        const t = v[0]
        const diff = Date.now() - t
        if (diff > CACHE_CLEAR) {
          this.store.delete(k)
        }
      })
    }, 5000)
  }

  add (txid, data) {
    this.store.set(txid, [Date.now(), data])
  }

  exists (txid) {
    return this.store.has(txid)
  }

  clear () {
    this.store.clear()
  }

  get (id) {
    const d =  this.store.get(id)
    if(d) return d[1]
    return null
  }
}

module.exports = Cache
