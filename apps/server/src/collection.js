import { debounce, findIndex, isUndefined, max, now, result } from 'lodash';

import { History } from './history';
import { Node } from './node';

export class Collection {
  constructor (externalAPI) {
    this._items = [];
    this._blockchain = new History();
    this._askedForHistory = false;
    this._askedForHistoryTime = 0;
    this._debounced = null;
    this._externalAPI = externalAPI;
    this._highestBlock = 0;
  }

  setupSockets () {
    this._externalAPI.on('connection', function (spark) {
      this._externalAPI.on('latestBlock', function () {
        spark.emit('latestBlock', {
          number: this._highestBlock
        });
      });
    });
  };

  add (data, callback) {
    const node = this.getNodeOrNew({ id: data.id }, data);
    node.setInfo(data, callback);
  };

  update (id, stats, callback) {
    const node = this.getNode({ id });

    if (!node) {
      callback('Node not found', null);
    } else {
    // this._blockchain.clean(this.getBestBlockFromItems());

      const block = this._blockchain.add(stats.block, id, node.trusted);

      if (!block) {
        callback('Block data wrong', null);
      } else {
        const propagationHistory = this._blockchain.getNodePropagation(id);

        stats.block.arrived = block.block.arrived;
        stats.block.received = block.block.received;
        stats.block.propagation = block.block.propagation;

        node.setStats(stats, propagationHistory, callback);
      }
    }
  };

  addBlock (id, stats, callback) {
    const node = this.getNode({ id });

    if (!node) {
      callback('Node not found', null);
    } else {
    // this._blockchain.clean(this.getBestBlockFromItems());

      const block = this._blockchain.add(stats, id, node.trusted);

      if (!block) {
        callback('Block undefined', null);
      } else {
        const propagationHistory = this._blockchain.getNodePropagation(id);

        stats.arrived = block.block.arrived;
        stats.received = block.block.received;
        stats.propagation = block.block.propagation;

        if (block.block.number > this._highestBlock) {
          this._highestBlock = block.block.number;
          this._externalAPI.write({
            action: 'lastBlock',
            number: this._highestBlock
          });
        }

        node.setBlock(stats, propagationHistory, callback);
      }
    }
  };

  updatePending (id, stats, callback) {
    const node = this.getNode({ id });

    if (!node) { return false; }

    node.setPending(stats, callback);
  };

  updateStats (id, stats, callback) {
    const node = this.getNode({ id });

    if (!node) {
      callback('Node not found', null);
    } else {
      node.setBasicStats(stats, callback);
    }
  };

  // TODO: Async series
  addHistory (id, blocks, callback) {
    const node = this.getNode({ id });

    if (!node) {
      callback('Node not found', null);
    } else {
      blocks = blocks.reverse();

      // this._blockchain.clean(this.getBestBlockFromItems());

      for (let i = 0; i <= blocks.length - 1; i++) {
        this._blockchain.add(blocks[i], id, node.trusted, true);
      };

      this.getCharts();
    }

    this.askedForHistory(false);
  };

  updateLatency (id, latency, callback) {
    const node = this.getNode({ id });

    if (!node) { return false; }

    node.setLatency(latency, callback);
  };

  inactive (id, callback) {
    const node = this.getNode({ spark: id });

    if (!node) {
      callback('Node not found', null);
    } else {
      node.setState(false);
      callback(null, node.getStats());
    }
  };

  getIndex (search) {
    return findIndex(this._items, search);
  };

  getNode (search) {
    const index = this.getIndex(search);

    if (index >= 0) { return this._items[index]; }

    return false;
  };

  getNodeByIndex (index) {
    if (this._items[index]) { return this._items[index]; }

    return false;
  };

  getIndexOrNew (search, data) {
    const index = this.getIndex(search);

    return (index >= 0 ? index : this._items.push(new Node(data)) - 1);
  };

  getNodeOrNew (search, data) {
    return this.getNodeByIndex(this.getIndexOrNew(search, data));
  };

  all () {
    this.removeOldNodes();

    return this._items;
  };

  removeOldNodes () {
    const deleteList = [];

    for (let i = this._items.length - 1; i >= 0; i--) {
      if (this._items[i].isInactiveAndOld()) {
        deleteList.push(i);
      }
    }

    if (deleteList.length > 0) {
      for (let i = 0; i < deleteList.length; i++) {
        this._items.splice(deleteList[i], 1);
      }
    }
  };

  blockPropagationChart () {
    return this._blockchain.getBlockPropagation();
  };

  getUncleCount () {
    return this._blockchain.getUncleCount();
  };

  setChartsCallback (callback) {
    this._blockchain.setCallback(callback);
  };

  getCharts () {
    this.getChartsDebounced();
  };

  getChartsDebounced () {
    const self = this;

    if (this._debounced === null) {
      this._debounced = debounce(function () {
        self._blockchain.getCharts();
      }, 1000, {
        leading: false,
        maxWait: 5000,
        trailing: true
      });
    }

    this._debounced();
  };

  getHistory () {
    return this._blockchain;
  };

  getBestBlockFromItems () {
    return Math.max(this._blockchain.bestBlockNumber(), result(max(this._items, function (item) {
    // return ( !item.trusted ? 0 : item.stats.block.number );
      return (item.stats.block.number);
    }), 'stats.block.number', 0));
  };

  canNodeUpdate (id) {
    const node = this.getNode({ id });

    if (!node) { return false; }

    if (node.canUpdate()) {
      const diff = node.getBlockNumber() - this._blockchain.bestBlockNumber();

      return Boolean(diff >= 0);
    }

    return false;
  };

  requiresUpdate (id) {
    return this.canNodeUpdate(id) &&
      this._blockchain.requiresUpdate() &&
      (!this._askedForHistory || now() - this._askedForHistoryTime > 2 * 60 * 1000);
  };

  askedForHistory (set) {
    if (!isUndefined(set)) {
      this._askedForHistory = set;

      if (set === true) {
        this._askedForHistoryTime = now();
      }
    }

    return (this._askedForHistory || now() - this._askedForHistoryTime < 2 * 60 * 1000);
  };
}
