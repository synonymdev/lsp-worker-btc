# Blocktank Bitcoin Worker
Microservice worker to interact with Bitcoin node

## Features

* Support for various Bitcoin RPC endpoints
* Support for watching mempool
* Support for sweeping the blockchain
  * Alerts on new block


## Getting started

```
npm install
```

Next set up your config by copying the examples...

```
cp ./config/blocks.worker.config.json.example ./config/blocks.worker.config.json
cp ./config/mempool.worker.config.json.example ./config/mempool.worker.config.json
cp ./config/worker.config.json.example ./config/worker.config.json
```

`worker.config.json` will require credentials of a Bitcoin node in it.
For a development environment, we recommend installing [Polar](https://lightningpolar.com/) so you can easily spin up a node for testing. The example credentials in the config file match the defaults for a Bitcoin node created in Polar.

You will also need MongoDB running. `worker.config.json` can be updated to include connection information for your DB.

Blocktank uses [Grenache](https://github.com/bitfinexcom/grenache), a DHT based high performance microservices framework, to distribute and hand out tasks to workers. To create the DHT network, run 2 instances of [Grape](https://github.com/bitfinexcom/grenache-grape) to get started...

```
grape --dp 20001 --aph 30001 --bn '127.0.0.1:20002'
grape --dp 20002 --aph 40001 --bn '127.0.0.1:20001
```

## Running everything

You can either launch each of the workers in this repo manually as follows...

```
node start.bitcoin.js
node start.blocks.js
node start.mempool.js
```

or use [pm2](https://pm2.keymetrics.io/docs/usage/process-management/) to run them all and manage all the processes for you...

```
pm2 start ecosystem.config.js
```

