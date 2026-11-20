const assert = require('node:assert/strict');
const http = require('node:http');
const mode = process.argv[2];
const db = require('../../src/config/db');
let disconnects = 0, flushes = 0, closed = 0;
const records = [];
const entered = Promise.withResolvers(), release = Promise.withResolvers();
const socketEntered = Promise.withResolvers(), socketRelease = Promise.withResolvers();
db.connectDB = async () => {};
db.disconnectDB = async () => { disconnects++; if (mode === 'db-failure') throw Error('PRIVATE_TOKEN'); };
for (const name of ['users', 'products', 'orders', 'deliveries']) require('../../src/repositories/' + name + '.repository').prototype.initialize = async () => {};
require('../../src/repositories/users.repository').prototype.list = async () => { entered.resolve(); await release.promise; return { docs: [], page: 1, totalPages: 1 }; };
require('../../src/repositories/products.repository').prototype.getProducts = async () => { socketEntered.resolve(); await socketRelease.promise; return []; };
(async () => {
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  process.env.PORT = String(reservation.address().port); await new Promise(resolve => reservation.close(resolve));
  process.env.NODE_ENV = 'production'; process.env.LOG_LEVEL = 'info'; process.env.MONGODB_URI = 'mongodb://synthetic.invalid/test';
  const baseline = ['SIGTERM', 'SIGINT'].map(name => process.listenerCount(name));
  const logger = { log(level, message, meta) { records.push({ level, ...meta }); if (meta.event === 'server.shutdown_timeout') process.stdout.write('deadline-safe\n'); }, shutdown: async () => { flushes++; } };
  const { startServer } = require('../../src/server');
  const instance = await startServer({ loggerFactory: options => { assert.equal(options.logLevel, 'info'); return logger; }, shutdownTimeoutMs: mode === 'deadline' ? 0 : 3000 });
  assert.ok(instance); instance.server.on('close', () => { closed++; });
  if (mode === 'db-failure') {
    await assert.rejects(instance.close(), /cierre/); assert.equal(process.exitCode, 1); assert.equal(flushes, 1); assert.equal(disconnects, 1);
    process.stdout.write('failure-safe\n'); return;
  }
  const base = 'http://127.0.0.1:' + process.env.PORT;
  const pending = fetch(base + '/api/users'); pending.catch(() => {}); await entered.promise;
  if (mode === 'deadline') { void instance.close(); return; }
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
  socket.addEventListener('message', event => { if (String(event.data).startsWith('0')) socket.send('40'); });
  socket.addEventListener('error', () => {});
  await socketEntered.promise;
  let done;
  if (mode === 'signal') { process.kill(process.pid, 'SIGTERM'); await new Promise(resolve => setImmediate(resolve)); done = instance.close(); }
  else { done = instance.close(); assert.equal(instance.close(), done); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disconnects, 0); assert.equal(flushes, 0);
  socketRelease.resolve(); release.resolve();
  const r = await pending; assert.equal(r.status, 200); await r.text();
  await done;
  assert.equal(disconnects, 1); assert.equal(flushes, 1); assert.equal(closed, 1);
  assert.equal(instance.server.listening, false); assert.equal(instance.io.engine.clientsCount, 0);
  assert.deepEqual(['SIGTERM', 'SIGINT'].map(name => process.listenerCount(name)), baseline);
  assert.equal(records.filter(row => row.event === 'server.stopped').length, 1);
  assert.ok(!records.some(row => row.event === 'server.shutdown_timeout'));
  assert.ok(!process.exitCode); process.stdout.write('drained-safe\n');
})().catch(() => { process.stderr.write('lifecycle-test-failed\n'); process.exit(2); });
