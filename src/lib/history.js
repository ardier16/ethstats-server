import d3 from 'd3';
import _ from 'lodash';

const MAX_HISTORY = 2000;

const MAX_PEER_PROPAGATION = 40;
const MIN_PROPAGATION_RANGE = 0;
const MAX_PROPAGATION_RANGE = 10000;

const MAX_UNCLES = 1000;
const MAX_UNCLES_PER_BIN = 25;
const MAX_BINS = 40;

export class History {
  constructor () {
    this._items = [];
    this._callback = null;
  }

  add (block, id, trusted, addingHistory) {
    let changed = false;

    if (!_.isUndefined(block) && !_.isUndefined(block.number) && !_.isUndefined(block.uncles) && !_.isUndefined(block.transactions) && !_.isUndefined(block.difficulty) && block.number > 0) {
      trusted = (process.env.LITE === 'true' ? true : trusted);
      const historyBlock = this.search(block.number);
      let forkIndex = -1;

      const now = _.now();

      block.trusted = trusted;
      block.arrived = now;
      block.received = now;
      block.propagation = 0;
      block.fork = 0;

      if (historyBlock) {
        // We already have a block with this height in collection

        // Check if node already checked this block height
        const propIndex = _.findIndex(historyBlock.propagTimes, { node: id });

        // Check if node already check a fork with this height
        forkIndex = this.compareForks(historyBlock, block);

        if (propIndex === -1) {
          // Node didn't submit this block before
          if (forkIndex >= 0 && !_.isUndefined(historyBlock.forks[forkIndex])) {
            // Found fork => update data
            block.arrived = historyBlock.forks[forkIndex].arrived;
            block.propagation = now - historyBlock.forks[forkIndex].received;
          } else {
            // No fork found => add a new one
            var prevBlock = this.prevMaxBlock(block.number);

            if (prevBlock) {
              block.time = Math.max(block.arrived - prevBlock.block.arrived, 0);

              if (block.number < this.bestBlock().height) { block.time = Math.max((block.timestamp - prevBlock.block.timestamp) * 1000, 0); }
            } else {
              block.time = 0;
            }

            forkIndex = historyBlock.forks.push(block) - 1;
            historyBlock.forks[forkIndex].fork = forkIndex;
          }

          // Push propagation time
          historyBlock.propagTimes.push({
            node: id,
            trusted,
            fork: forkIndex,
            received: now,
            propagation: block.propagation
          });
        } else {
          // Node submited the block before
          if (forkIndex >= 0 && !_.isUndefined(historyBlock.forks[forkIndex])) {
            // Matching fork found => update data
            block.arrived = historyBlock.forks[forkIndex].arrived;

            if (forkIndex === historyBlock.propagTimes[propIndex].fork) {
              // Fork index is the same
              block.received = historyBlock.propagTimes[propIndex].received;
              block.propagation = historyBlock.propagTimes[propIndex].propagation;
            } else {
              // Fork index is different
              historyBlock.propagTimes[propIndex].fork = forkIndex;
              historyBlock.propagTimes[propIndex].propagation = block.propagation = now - historyBlock.forks[forkIndex].received;
            }
          } else {
            // No matching fork found => replace old one
            block.received = historyBlock.propagTimes[propIndex].received;
            block.propagation = historyBlock.propagTimes[propIndex].propagation;

            prevBlock = this.prevMaxBlock(block.number);
            if (prevBlock) {
              block.time = Math.max(block.arrived - prevBlock.block.arrived, 0);

              if (block.number < this.bestBlock().height) { block.time = Math.max((block.timestamp - prevBlock.block.timestamp) * 1000, 0); }
            } else {
              block.time = 0;
            }

            forkIndex = historyBlock.forks.push(block) - 1;
            historyBlock.forks[forkIndex].fork = forkIndex;
          }
        }

        if (trusted && !this.compareBlocks(historyBlock.block, historyBlock.forks[forkIndex])) {
          // If source is trusted update the main block
          historyBlock.forks[forkIndex].trusted = trusted;
          historyBlock.block = historyBlock.forks[forkIndex];
        }

        block.fork = forkIndex;

        changed = true;
      } else {
        // Couldn't find block with this height

        // Getting previous max block
        prevBlock = this.prevMaxBlock(block.number);
        if (prevBlock) {
          block.time = Math.max(block.arrived - prevBlock.block.arrived, 0);

          if (block.number < this.bestBlock().height) { block.time = Math.max((block.timestamp - prevBlock.block.timestamp) * 1000, 0); }
        } else {
          block.time = 0;
        }

        const item = {
          height: block.number,
          block,
          forks: [block],
          propagTimes: []
        };

        if (this._items.length === 0 || (this._items.length > 0 && block.number > this.worstBlockNumber()) || (this._items.length < MAX_HISTORY && block.number < this.bestBlockNumber() && addingHistory)) {
          item.propagTimes.push({
            node: id,
            trusted,
            fork: 0,
            received: now,
            propagation: block.propagation
          });

          this._save(item);

          changed = true;
        }
      }

      return {
        block,
        changed
      };
    }

    return false;
  };

  compareBlocks (block1, block2) {
    if (block1.hash !== block2.hash ||
   block1.parentHash !== block2.parentHash ||
   block1.sha3Uncles !== block2.sha3Uncles ||
   block1.transactionsRoot !== block2.transactionsRoot ||
   block1.stateRoot !== block2.stateRoot ||
   block1.miner !== block2.miner ||
   block1.difficulty !== block2.difficulty ||
   block1.totalDifficulty !== block2.totalDifficulty) { return false; }

    return true;
  }

  compareForks (historyBlock, block2) {
    if (_.isUndefined(historyBlock)) { return -1; }

    if (_.isUndefined(historyBlock.forks) || historyBlock.forks.length === 0) { return -1; }

    for (let x = 0; x < historyBlock.forks.length; x++) {
      if (this.compareBlocks(historyBlock.forks[x], block2)) { return x; }
    }

    return -1;
  }

  _save (block) {
    this._items.unshift(block);

    this._items = _.orderBy(this._items, 'height', 'desc');

    if (this._items.length > MAX_HISTORY) {
      this._items.pop();
    }
  };

  clean (max) {
    if (max > 0 && this._items.length > 0 && max < this.bestBlockNumber()) {
      console.log('MAX:', max);

      console.log('History items before:', this._items.length);

      this._items = _(this._items).filter(function (item) {
        return (item.height <= max && item.block.trusted === false);
      }).value();

      console.log('History items after:', this._items.length);
    }
  };

  search (number) {
    const index = _.findIndex(this._items, { height: number });

    if (index < 0) { return false; }

    return this._items[index];
  };

  prevMaxBlock (number) {
    const index = _.findIndex(this._items, function (item) {
      return item.height < number;
    });

    if (index < 0) { return false; }

    return this._items[index];
  };

  bestBlock () {
    return _.maxBy(this._items, 'height');
  };

  bestBlockNumber () {
    const best = this.bestBlock();

    if (!_.isUndefined(best) && !_.isUndefined(best.height)) { return best.height; }

    return 0;
  };

  worstBlock () {
    return _.minBy(this._items, 'height');
  };

  worstBlockNumber (trusted) {
    const worst = this.worstBlock();

    if (!_.isUndefined(worst) && !_.isUndefined(worst.height)) { return worst.height; }

    return 0;
  };

  getNodePropagation (id) {
    const propagation = new Array(MAX_PEER_PROPAGATION);
    const bestBlock = this.bestBlockNumber();
    let lastBlocktime = _.now();

    _.fill(propagation, -1);

    const sorted = _(this._items)
      .sortBy('height', false)
      .slice(0, MAX_PEER_PROPAGATION)
      .forEach(function (item, key) {
        const index = MAX_PEER_PROPAGATION - 1 - bestBlock + item.height;

        if (index >= 0) {
          const tmpPropagation = _.result(_.find(item.propagTimes, 'node', id), 'propagation', false);

          if (_.result(_.find(item.propagTimes, 'node', id), 'propagation', false) !== false) {
            propagation[index] = tmpPropagation;
            lastBlocktime = item.block.arrived;
          } else {
            propagation[index] = Math.max(0, lastBlocktime - item.block.arrived);
          }
        }
      })
      .reverse();

    return propagation;
  };

  getBlockPropagation () {
    const propagation = [];
    let avgPropagation = 0;

    _.forEach(this._items, function (n, key) {
      _.forEach(n.propagTimes, function (p, i) {
        const prop = Math.min(MAX_PROPAGATION_RANGE, _.result(p, 'propagation', -1));

        if (prop >= 0) { propagation.push(prop); }
      });
    });

    if (propagation.length > 0) {
      avgPropagation = Math.round(_.sum(propagation) / propagation.length);
    }

    const data = d3.layout.histogram()
      .frequency(false)
      .range([MIN_PROPAGATION_RANGE, MAX_PROPAGATION_RANGE])
      .bins(MAX_BINS)(propagation);

    let freqCum = 0;
    const histogram = data.map(function (val) {
      freqCum += val.length;
      const cumPercent = (freqCum / Math.max(1, propagation.length));

      return {
        x: val.x,
        dx: val.dx,
        y: val.y,
        frequency: val.length,
        cumulative: freqCum,
        cumpercent: cumPercent
      };
    });

    return {
      histogram,
      avg: avgPropagation
    };
  };

  getUncleCount () {
    const uncles = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    //  return item.block.trusted;
    // })
      .slice(0, MAX_UNCLES)
      .map(function (item) {
        return item.block.uncles.length;
      })
      .value();

    const uncleBins = _.fill(Array(MAX_BINS), 0);

    const sumMapper = (array, key) => {
      uncleBins[key] = _.sum(array);
      return _.sum(array);
    };

    _.map(_.chunk(uncles, MAX_UNCLES_PER_BIN), sumMapper);

    return uncleBins;
  };

  getBlockTimes () {
    const blockTimes = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    // return item.block.trusted;
    // })
      .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.time / 1000;
      })
      .value();

    return blockTimes;
  };

  getAvgBlocktime () {
    const blockTimes = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    // return item.block.trusted;
    // })
    // .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.time / 1000;
      })
      .value();

    return _.sum(blockTimes) / (blockTimes.length === 0 ? 1 : blockTimes.length);
  };

  getGasLimit () {
    const gasLimitHistory = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    //  return item.block.trusted;
    // })
      .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.gasLimit;
      })
      .value();

    return gasLimitHistory;
  };

  getDifficulty () {
    const difficultyHistory = _(this._items)
      .sortBy('height', false)
      .filter(function (item) {
        return item.block.trusted;
      })
      .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.difficulty;
      })
      .value();

    return difficultyHistory;
  };

  getTransactionsCount () {
    const txCount = _(this._items)
      .sortBy('height', false)
      .filter(function (item) {
        return item.block.trusted;
      })
      .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.transactions.length;
      })
      .value();

    return txCount;
  };

  getGasSpending () {
    const gasSpending = _(this._items)
      .sortBy('height', false)
      .filter(function (item) {
        return item.block.trusted;
      })
      .slice(0, MAX_BINS)
      .reverse()
      .map(function (item) {
        return item.block.gasUsed;
      })
      .value();

    return gasSpending;
  };

  getAvgHashrate () {
    if (_.isEmpty(this._items)) { return 0; }

    const blocktimeHistory = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    //  return item.block.trusted;
    // })
      .slice(0, 64)
      .map(function (item) {
        return item.block.time;
      })
      .value();

    const avgBlocktime = (_.sum(blocktimeHistory) / blocktimeHistory.length) / 1000;

    return this.bestBlock().block.difficulty / avgBlocktime;
  };

  getMinersCount () {
    const miners = _(this._items)
      .sortBy('height', false)
    // .filter(function (item)
    // {
    //  return item.block.trusted;
    // })
      .slice(0, MAX_BINS)
      .map(function (item) {
        return item.block.miner;
      })
      .value();

    const minerCount = [];

    _.forEach(_.countBy(miners), function (cnt, miner) {
      minerCount.push({ miner, name: false, blocks: cnt });
    });

    return _(minerCount)
      .sortBy('blocks', false)
      .slice(0, 2)
      .value();
  };

  setCallback (callback) {
    this._callback = callback;
  };

  getCharts () {
    if (this._callback !== null) {
      const chartHistory = _(this._items)
        .orderBy('height', 'desc')
      // .filter(function (item)
      // {
      //  return item.block.trusted;
      // })
        .slice(0, MAX_BINS)
        .reverse()
        .map(function (item) {
          return {
            height: item.height,
            blocktime: item.block.time / 1000,
            difficulty: item.block.difficulty,
            uncles: item.block.uncles.length,
            transactions: item.block.transactions ? item.block.transactions.length : 0,
            gasSpending: item.block.gasUsed,
            gasLimit: item.block.gasLimit,
            miner: item.block.miner
          };
        })
        .value();

      this._callback(null, {
        height: _.map(chartHistory, 'height'),
        blocktime: _.map(chartHistory, 'blocktime'),
        // avgBlocktime : _.sum(_.map( chartHistory, 'blocktime' )) / (chartHistory.length === 0 ? 1 : chartHistory.length),
        avgBlocktime: this.getAvgBlocktime(),
        difficulty: _.map(chartHistory, 'difficulty'),
        uncles: _.map(chartHistory, 'uncles'),
        transactions: _.map(chartHistory, 'transactions'),
        gasSpending: _.map(chartHistory, 'gasSpending'),
        gasLimit: _.map(chartHistory, 'gasLimit'),
        miners: this.getMinersCount(),
        propagation: this.getBlockPropagation(),
        uncleCount: this.getUncleCount(),
        avgHashrate: this.getAvgHashrate()
      });
    }
  };

  requiresUpdate () {
    // return ( this._items.length < MAX_HISTORY && !_.isEmpty(this._items) );
    return (this._items.length < MAX_HISTORY);
  };

  getHistoryRequestRange () {
    if (this._items.length < 2) { return false; }

    const blocks = _.map(this._items, 'height');
    const best = _.max(blocks);
    const range = _.range(_.max([0, best - MAX_HISTORY]), best + 1);

    const missing = _.difference(range, blocks);

    const max = _.max(missing);
    const min = max - Math.min(50, (MAX_HISTORY - this._items.length + 1)) + 1;

    return {
      max,
      min,
      list: _(missing).reverse().slice(0, 50).reverse().value()
    };
  };
};
