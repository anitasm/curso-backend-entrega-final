const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createApp = require('../src/app');
const { fixtures } = require('./helpers/fixtures');
const mocksFixture = require('./helpers/mocks-fixtures');
const errors = require('../src/middlewares/errors');
const httpLogger = require('../src/middlewares/http-logger');
const { getContext } = require('../src/utils/request-context');
const { notifyProducts } = require('../src/sockets/products');
const { cleanupUpload } = require('../src/middlewares/upload');
const fs = require('node:fs/promises');
const secret = 'PRIVATE_TOKEN_EMAIL@example.test_mongodb://PRIVATE_USER:PRIVATE_PASS@host';
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function capture() {
  const rows = [];
  return { rows, log: (level, message, meta) => rows.push({ level, message, ...meta }) };
}
async function listen(t, app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
async function setup(t, nodeEnv = 'test') {
  const logger = capture(), f = fixtures(), mocks = mocksFixture();
  const base = await listen(t, createApp({ ...f, mocksService: mocks.service, logger, nodeEnv }));
  const request = async (route, options) => {
    const r = await fetch(base + route, options);
    return { id: r.headers.get('x-request-id'), status: r.status, body: await r.json() };
  };
  return { logger, f, mocks, request };
}
function correlated(logger, response, code) {
  assert.match(response.id, uuid);
  const rows = logger.rows.filter(x => x.requestId === response.id);
  const access = rows.filter(x => x.event === 'http.access');
  assert.equal(access.length, 1);
  assert.equal(access[0].statusCode, response.status);
  assert.ok(access[0].durationMs >= 0);
  const failures = rows.filter(x => x.event === 'http.error');
  assert.equal(failures.length, code ? 1 : 0);
  if (code) {
    assert.equal(failures[0].code, code);
    assert.equal(failures[0].level, response.status >= 500 ? 'error' : 'warning');
    assert.deepEqual(Object.keys(response.body).sort(), ['error', 'message', 'status']);
  }
  return rows;
}

test('Logging HTTP: diagnóstico emite seis eventos y el fatal simulado no detiene health', async t => {
  for (const env of ['development', 'test']) {
    const f = await setup(t, env);
    const response = await f.request('/loggerTest');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'success', message: 'Logs de diagnóstico generados' });
    const events = correlated(f.logger, response).filter(x => x.event === 'logger.test');
    assert.deepEqual(events.map(x => x.level), ['debug', 'http', 'info', 'warning', 'error', 'fatal']);
    assert.ok(events.every(x => x.synthetic === true));
    const health = await f.request('/api/health');
    assert.equal(health.body.status, 'ok');
    correlated(f.logger, health);
  }
  const production = await setup(t, 'production');
  const blocked = await production.request('/loggerTest');
  assert.equal(blocked.status, 404);
  correlated(production.logger, blocked, 'ROUTE_NOT_FOUND');
  assert.equal(production.logger.rows.filter(x => x.event === 'logger.test').length, 0);
});

test('Logging HTTP: 200, 404, parser y 5xx mantienen contexto sin datos sensibles', async t => {
  const f = await setup(t);
  const options = { headers: { Authorization: secret, Cookie: secret, 'X-Request-Id': secret } };
  correlated(f.logger, await f.request('/api/health?token=' + encodeURIComponent(secret), options));
  correlated(f.logger, await f.request('/' + encodeURIComponent(secret), options), 'ROUTE_NOT_FOUND');
  correlated(f.logger, await f.request('/api/mocks/generateData', { method: 'POST', headers: { ...options.headers, 'Content-Type': 'application/json' }, body: '{"secret":"' + secret }), 'INVALID_JSON');
  f.f.usersRepository.list = async () => { throw new Error(secret); };
  correlated(f.logger, await f.request('/api/users', options), 'INTERNAL_SERVER_ERROR');
  assert.ok(!JSON.stringify(f.logger.rows).includes(secret));
  assert.doesNotMatch(JSON.stringify(f.logger.rows), /PRIVATE_TOKEN|PRIVATE_USER|PRIVATE_PASS|originalUrl|stack|cause|Authorization|Cookie/);
});

test('Logging HTTP: solicitudes solapadas conservan IDs independientes', async t => {
  const f = await setup(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const contexts = [];
  f.f.usersRepository.list = async () => {
    contexts.push(getContext().requestId);
    if (contexts.length === 2) release();
    await gate;
    assert.ok(contexts.includes(getContext().requestId));
    throw new Error(secret);
  };
  const replies = await Promise.all([f.request('/api/users?limit=1'), f.request('/api/users?limit=2')]);
  assert.notEqual(replies[0].id, replies[1].id);
  assert.deepEqual(new Set(contexts), new Set(replies.map(x => x.id)));
  for (const r of replies) correlated(f.logger, r, 'INTERNAL_SERVER_ERROR');
});

test('Logging HTTP: éxito de mocks se correlaciona una vez y rollback no registra éxito', async t => {
  const f = await setup(t);
  for (const route of ['/api/mocks/users?qty=2', '/api/mocks/seed?qty=2']) {
    const response = await f.request(route, { method: 'POST' });
    const rows = correlated(f.logger, response);
    assert.equal(rows.filter(x => x.event === 'mocks.started').length, 1);
    const successes = rows.filter(x => x.event === 'mocks.committed');
    assert.equal(successes.length, 1); assert.equal(successes[0].users, 1); assert.equal(successes[0].drivers, 1);
  }
  const original = f.mocks.service.usersRepository.insertMany;
  let attempt = 0;
  const transient = Object.assign(new Error(secret), { errorLabels: ['TransientTransactionError'] });
  f.mocks.service.usersRepository.insertMany = async (...args) => { if (++attempt === 1) throw transient; return original(...args); };
  f.mocks.service.withTransaction = async work => {
    // Use the fixture transaction's own session for both attempts.
    const transaction = f.mocks.dependencies.withTransaction;
    await assert.rejects(transaction(work), e => e === transient);
    return transaction(work);
  };
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"users":1,"orders":1,"deliveries":1}' };
  const successful = await f.request('/api/mocks/generateData', options);
  const rows = correlated(f.logger, successful);
  assert.equal(rows.filter(x => x.event === 'mocks.committed').length, 1);
  assert.equal(rows.find(x => x.event === 'mocks.committed').orders, 1);
  f.mocks.service.withTransaction = async () => { throw new Error(secret); };
  const failed = await f.request('/api/mocks/generateData', options);
  assert.equal(correlated(f.logger, failed, 'MOCK_GENERATION_ERROR').filter(x => x.event === 'mocks.committed').length, 0);
});

test('Logging HTTP: respuesta parcial se cierra sin el manejador crudo de Express', async t => {
  const logger = capture(), app = express();
  let consoleErrors = '';
  t.mock.method(console, 'error', (...args) => { consoleErrors += args.join(' '); });
  app.use(httpLogger(logger));
  app.get('/partial', (_req, res, next) => {
    res.write('partial');
    setImmediate(() => next(new Error(secret)));
  });
  app.use(errors);
  app.use(errors.closePartial);
  const base = await listen(t, app);
  let id;
  await new Promise((resolve, reject) => {
    http.get(base + '/partial', res => {
      id = res.headers['x-request-id'];
      res.resume();
      res.once('aborted', resolve);
      res.once('end', () => reject(new Error('Debe cerrar la respuesta parcial')));
      res.on('error', () => {});
    }).on('error', reject);
  });
  assert.match(id, uuid);
  assert.equal(logger.rows.filter(x => x.event === 'http.error').length, 1);
  assert.ok(logger.rows.every(x => x.requestId === id));
  assert.equal(consoleErrors, '');
  assert.ok(!JSON.stringify(logger.rows).includes(secret));
});

test('Logging operativo: limpieza y notificaciones mantienen mejor esfuerzo', async t => {
  const logger = capture();
  t.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error(secret), { code: 'EACCES' }); });
  await cleanupUpload({ path: secret }, logger);
  await notifyProducts({ emit: () => { throw new Error(secret); } }, { getProducts: async () => [] }, logger);
  assert.deepEqual(logger.rows.map(x => x.event), ['upload.cleanup_failed', 'catalog.notify_failed']);
  assert.ok(logger.rows.every(x => x.level === 'warning'));
  assert.ok(!JSON.stringify(logger.rows).includes(secret));
});
