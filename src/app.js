import chalk from 'chalk';
import http from 'http';
import { get, isNull, isUndefined, now, values } from 'lodash';
import Primus from 'primus';

import { Collection } from './lib/collection';
import { config } from './lib/config';
import app from './lib/express';
import { initLogger } from './lib/logger';

initLogger();

// Init WS SECRET
let WS_SECRET;

if (!isUndefined(process.env.WS_SECRET) && !isNull(process.env.WS_SECRET)) {
  WS_SECRET = process.env.WS_SECRET.indexOf('|') > 0
    ? process.env.WS_SECRET.split('|')
    : [process.env.WS_SECRET];
} else {
  try {
    WS_SECRET = values(require('../ws_secret.json'));
  } catch (e) {
    console.error('WS_SECRET NOT SET!!!');
  }
}

const { banned, reserved } = config;

// Init http server
const server = process.env.NODE_ENV === 'production'
  ? http.createServer()
  : http.createServer(app);

// Init API Socket connection
const api = new Primus(server, {
  transformer: 'websockets',
  pathname: '/api',
  parser: 'JSON'
});

api.plugin('emit', require('primus-emit'));
api.plugin('spark-latency', require('primus-spark-latency'));

// Init Client Socket connection
const client = new Primus(server, {
  transformer: 'websockets',
  pathname: '/primus',
  parser: 'JSON'
});

client.plugin('emit', require('primus-emit'));

// Init external API
const external = new Primus(server, {
  transformer: 'websockets',
  pathname: '/external',
  parser: 'JSON'
});

external.plugin('emit', require('primus-emit'));

const Nodes = new Collection(external);

Nodes.setChartsCallback(function (err, charts) {
  if (err !== null) {
    console.error('COL', 'CHR', 'Charts error:', err);
  } else {
    client.write({
      action: 'charts',
      data: charts
    });
  }
});

// Init API Socket events
api.on('connection', (spark) => {
  console.info('API', 'CON', 'Open:', spark.address.ip);

  spark.on('hello', (data) => {
    console.info('API', 'CON', 'Hello', data.id);

    if (isUndefined(data.secret) || WS_SECRET.indexOf(data.secret) === -1 || banned.indexOf(spark.address.ip) >= 0 || isUndefined(data.id) || reserved.indexOf(data.id) >= 0) {
      spark.end(undefined, { reconnect: false });
      console.error('API', 'CON', 'Closed - wrong auth', data);

      return false;
    }

    if (!isUndefined(data.id) && !isUndefined(data.info)) {
      data.ip = spark.address.ip;
      data.spark = spark.id;
      data.latency = spark.latency || 0;

      Nodes.add(data, function (err, info) {
        if (err !== null) {
          console.error('API', 'CON', 'Connection error:', err);
          return false;
        }

        if (info !== null) {
          spark.emit('ready');

          console.success('API', 'CON', 'Connected', data.id);

          client.write({
            action: 'add',
            data: info
          });
        }
      });
    }
  });

  spark.on('update', function (data) {
    if (!isUndefined(data.id) && !isUndefined(data.stats)) {
      Nodes.update(data.id, data.stats, function (err, stats) {
        if (err !== null) {
          console.error('API', 'UPD', 'Update error:', err);
        } else {
          if (stats !== null) {
            client.write({
              action: 'update',
              data: stats
            });

            console.info('API', 'UPD', 'Update from:', data.id, 'for:', stats);

            Nodes.getCharts();
          }
        }
      });
    } else {
      console.error('API', 'UPD', 'Update error:', data);
    }
  });

  spark.on('block', function (data) {
    if (!isUndefined(data.id) && !isUndefined(data.block)) {
      Nodes.addBlock(data.id, data.block, function (err, stats) {
        if (err !== null) {
          console.error('API', 'BLK', 'Block error:', err);
        } else {
          if (stats !== null) {
            client.write({
              action: 'block',
              data: stats
            });

            console.success('API', 'BLK', 'Block:', data.block.number, 'td:', data.block.totalDifficulty, 'from:', data.id, 'ip:', spark.address.ip);

            Nodes.getCharts();
          }
        }
      });
    } else {
      console.error('API', 'BLK', 'Block error:', data);
    }
  });

  spark.on('pending', function (data) {
    if (!isUndefined(data.id) && !isUndefined(data.stats)) {
      Nodes.updatePending(data.id, data.stats, function (err, stats) {
        if (err !== null) {
          console.error('API', 'TXS', 'Pending error:', err);
        }

        if (stats !== null) {
          client.write({
            action: 'pending',
            data: stats
          });

          console.success('API', 'TXS', 'Pending:', data.stats.pending, 'from:', data.id);
        }
      });
    } else {
      console.error('API', 'TXS', 'Pending error:', data);
    }
  });

  spark.on('stats', function (data) {
    if (!isUndefined(data.id) && !isUndefined(data.stats)) {
      Nodes.updateStats(data.id, data.stats, function (err, stats) {
        if (err !== null) {
          console.error('API', 'STA', 'Stats error:', err);
        } else {
          if (stats !== null) {
            client.write({
              action: 'stats',
              data: stats
            });

            console.success('API', 'STA', 'Stats from:', data.id);
          }
        }
      });
    } else {
      console.error('API', 'STA', 'Stats error:', data);
    }
  });

  spark.on('history', function (data) {
    console.success('API', 'HIS', 'Got history from:', data.id);

    const time = chalk.reset.cyan((new Date()).toJSON()) + ' ';
    console.time(time, 'COL', 'CHR', 'Got charts in');

    Nodes.addHistory(data.id, data.history, function (err, history) {
      console.timeEnd(time, 'COL', 'CHR', 'Got charts in');

      if (err !== null) {
        console.error('COL', 'CHR', 'History error:', err);
      } else {
        client.write({
          action: 'charts',
          data: history
        });
      }
    });
  });

  spark.on('node-ping', function (data) {
    const start = (!isUndefined(data) && !isUndefined(data.clientTime) ? data.clientTime : null);

    spark.emit('node-pong', {
      clientTime: start,
      serverTime: now()
    });

    console.info('API', 'PIN', 'Ping from:', data.id);
  });

  spark.on('latency', function (data) {
    if (!isUndefined(data.id)) {
      Nodes.updateLatency(data.id, data.latency, function (err, latency) {
        if (err !== null) {
          console.error('API', 'PIN', 'Latency error:', err);
        }

        if (latency !== null) {
          // client.write({
          //   action: 'latency',
          //   data: latency
          // });

          console.info('API', 'PIN', 'Latency:', latency, 'from:', data.id);
        }
      });

      if (Nodes.requiresUpdate(data.id)) {
        const range = Nodes.getHistory().getHistoryRequestRange();

        spark.emit('history', range);
        console.info('API', 'HIS', 'Asked:', data.id, 'for history:', range.min, '-', range.max);

        Nodes.askedForHistory(true);
      }
    }
  });

  spark.on('end', function (data) {
    Nodes.inactive(spark.id, function (err, stats) {
      if (err !== null) {
        console.error('API', 'CON', 'Connection end error:', err);
      } else {
        client.write({
          action: 'inactive',
          data: stats
        });

        console.warn('API', 'CON', 'Connection with:', spark.id, 'ended:', data);
      }
    });
  });
});

client.on('connection', function (clientSpark) {
  clientSpark.on('ready', function () {
    clientSpark.emit('init', { nodes: Nodes.all() });

    Nodes.getCharts();
  });

  clientSpark.on('client-pong', function (data) {
    const serverTime = get(data, 'serverTime', 0);
    const latency = Math.ceil((now() - serverTime) / 2);

    clientSpark.emit('client-latency', { latency });
  });
});

setInterval(() => {
  client.write({
    action: 'client-ping',
    data: {
      serverTime: now()
    }
  });
}, 5000);

// Cleanup old inactive nodes
setInterval(() => {
  client.write({
    action: 'init',
    data: Nodes.all()
  });

  Nodes.getCharts();
}, 1000 * 60 * 60);

server.listen(process.env.PORT || 3000);
console.log('worked');
