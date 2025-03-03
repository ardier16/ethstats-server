import geoip from 'geoip-lite';
import { fill, filter, isArray, isEqual, isUndefined, now, result, sum } from 'lodash';

import { config } from './config';

const MAX_HISTORY = 40;
const MAX_INACTIVE_TIME = 1000 * 60 * 60 * 4;

export class Node {
  constructor (data) {
    this.id = null;
    this.trusted = false;
    this.info = {};
    this.geo = {};
    this.stats = {
      active: false,
      mining: false,
      hashrate: 0,
      peers: 0,
      pending: 0,
      gasPrice: 0,
      block: {
        number: 0,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        difficulty: 0,
        totalDifficulty: 0,
        gasLimit: 0,
        timestamp: 0,
        time: 0,
        arrival: 0,
        received: 0,
        propagation: 0,
        transactions: [],
        uncles: []
      },
      syncing: false,
      propagationAvg: 0,
      latency: 0,
      uptime: 100
    };

    this.history = new Array(MAX_HISTORY);

    this.uptime = {
      started: null,
      up: 0,
      down: 0,
      lastStatus: null,
      lastUpdate: null
    };

    this.init(data);
  }

  init (data) {
    fill(this.history, -1);

    if (this.id === null && this.uptime.started === null) { this.setState(true); }

    this.id = result(data, 'id', this.id);

    if (!isUndefined(data.latency)) { this.stats.latency = data.latency; }

    this.setInfo(data, null);
  };

  setInfo (data, callback) {
    if (!isUndefined(data.info)) {
      this.info = data.info;

      if (!isUndefined(data.info.canUpdateHistory)) {
        this.info.canUpdateHistory = result(data, 'info.canUpdateHistory', false);
      }
    }

    if (!isUndefined(data.ip)) {
      if (config.trusted.indexOf(data.ip) >= 0 || process.env.LITE === 'true') {
        this.trusted = true;
      }

      this.setGeo(data.ip);
    }

    this.spark = result(data, 'spark', null);

    this.setState(true);

    if (callback !== null) {
      callback(null, this.getInfo());
    }
  };

  setGeo (ip) {
    if (ip.substr(0, 7) === '::ffff:') {
      ip = ip.substr(7);
    }
    this.info.ip = ip;
    this.geo = geoip.lookup(ip);
  };

  getInfo () {
    return {
      id: this.id,
      info: this.info,
      stats: {
        active: this.stats.active,
        mining: this.stats.mining,
        syncing: this.stats.syncing,
        hashrate: this.stats.hashrate,
        peers: this.stats.peers,
        gasPrice: this.stats.gasPrice,
        block: this.stats.block,
        propagationAvg: this.stats.propagationAvg,
        uptime: this.stats.uptime,
        latency: this.stats.latency,
        pending: this.stats.pending,
      },
      history: this.history,
      geo: this.geo
    };
  };

  setStats (stats, history, callback = () => {}) {
    if (!isUndefined(stats)) {
      this.setBlock(result(stats, 'block', this.stats.block), history);
      this.setBasicStats(stats);
      this.setPending(result(stats, 'pending', this.stats.pending));

      callback(null, this.getStats());
    }

    callback('Stats undefined', null);
  };

  setBlock (block, history, callback = () => {}) {
    if (!isUndefined(block) && !isUndefined(block.number)) {
      if (!isEqual(history, this.history) || !isEqual(block, this.stats.block)) {
        if (block.number !== this.stats.block.number || block.hash !== this.stats.block.hash) {
          this.stats.block = block;
        }

        this.setHistory(history);

        callback(null, this.getBlockStats());
      } else {
        callback(null, null);
      }
    } else {
      callback('Block undefined', null);
    }
  };

  setHistory (history) {
    if (isEqual(history, this.history)) {
      return false;
    }

    if (!isArray(history)) {
      this.history = fill(new Array(MAX_HISTORY), -1);
      this.stats.propagationAvg = 0;

      return true;
    }

    this.history = history;

    let positives = filter(history, function (p) {
      return p >= 0;
    });

    this.stats.propagationAvg = (positives.length > 0 ? Math.round(sum(positives) / positives.length) : 0);
    positives = null;

    return true;
  };

  setPending (stats, callback = () => {}) {
    if (!isUndefined(stats) && !isUndefined(stats.pending)) {
      if (!isEqual(stats.pending, this.stats.pending)) {
        this.stats.pending = stats.pending;

        callback(null, {
          id: this.id,
          pending: this.stats.pending
        });
      } else {
        callback(null, null);
      }
    } else {
      callback('Stats undefined', null);
    }
  };

  setBasicStats (stats, callback = () => {}) {
    if (!isUndefined(stats)) {
      if (!isEqual(stats, {
        active: this.stats.active,
        mining: this.stats.mining,
        hashrate: this.stats.hashrate,
        peers: this.stats.peers,
        gasPrice: this.stats.gasPrice,
        uptime: this.stats.uptime
      })) {
        this.stats.active = stats.active;
        this.stats.mining = stats.mining;
        this.stats.syncing = (!isUndefined(stats.syncing) ? stats.syncing : false);
        this.stats.hashrate = stats.hashrate;
        this.stats.peers = stats.peers;
        this.stats.gasPrice = stats.gasPrice;
        this.stats.uptime = stats.uptime;

        callback(null, this.getBasicStats());
      } else {
        callback(null, null);
      }
    } else {
      callback('Stats undefined', null);
    }
  };

  setLatency (latency, callback = () => {}) {
    if (!isUndefined(latency)) {
      if (!isEqual(latency, this.stats.latency)) {
        this.stats.latency = latency;

        callback(null, {
          id: this.id,
          latency
        });
      } else {
        callback(null, null);
      }
    } else {
      callback('Latency undefined', null);
    }
  };

  getStats () {
    return {
      id: this.id,
      stats: {
        active: this.stats.active,
        mining: this.stats.mining,
        syncing: this.stats.syncing,
        hashrate: this.stats.hashrate,
        peers: this.stats.peers,
        gasPrice: this.stats.gasPrice,
        block: this.stats.block,
        propagationAvg: this.stats.propagationAvg,
        uptime: this.stats.uptime,
        pending: this.stats.pending,
        latency: this.stats.latency
      },
      history: this.history
    };
  };

  getBlockStats () {
    return {
      id: this.id,
      block: this.stats.block,
      propagationAvg: this.stats.propagationAvg,
      history: this.history
    };
  };

  getBasicStats () {
    return {
      id: this.id,
      stats: {
        active: this.stats.active,
        mining: this.stats.mining,
        syncing: this.stats.syncing,
        hashrate: this.stats.hashrate,
        peers: this.stats.peers,
        gasPrice: this.stats.gasPrice,
        uptime: this.stats.uptime,
        latency: this.stats.latency
      }
    };
  };

  setState (active) {
    let timeNow = now();

    if (this.uptime.started !== null) {
      if (this.uptime.lastStatus === active) {
        this.uptime[(active ? 'up' : 'down')] += timeNow - this.uptime.lastUpdate;
      } else {
        this.uptime[(active ? 'down' : 'up')] += timeNow - this.uptime.lastUpdate;
      }
    } else {
      this.uptime.started = timeNow;
    }

    this.stats.active = active;
    this.uptime.lastStatus = active;
    this.uptime.lastUpdate = timeNow;

    this.stats.uptime = this.calculateUptime();

    timeNow = undefined;
  };

  calculateUptime () {
    if (this.uptime.lastUpdate === this.uptime.started) {
      return 100;
    }

    return Math.round(this.uptime.up / (this.uptime.lastUpdate - this.uptime.started) * 100);
  };

  getBlockNumber () {
    return this.stats.block.number;
  };

  canUpdate () {
    return this.trusted || this.info.canUpdateHistory || (this.stats.syncing === false && this.stats.peers > 0);
  };

  isInactiveAndOld () {
    return this.uptime.lastStatus === false &&
      this.uptime.lastUpdate !== null &&
      (now() - this.uptime.lastUpdate) > MAX_INACTIVE_TIME;
  };
};
