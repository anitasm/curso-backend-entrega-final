const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createApp = require('../src/app');
const Service = require('../src/services/deliveries.service');
const Repository = require('../src/repositories/deliveries.repository');
const Delivery = require('../src/models/Delivery');
const { fixtures } = require('./helpers/fixtures');
const id = '000000000000000000000003';
const row = { _id: id, id, order: '000000000000000000000002', status: 'pending' };

test('Entregas HTTP: consultas, paginación, errores y correlación sin escrituras', async t => {
  const calls = [], logs = [];
  const repository = {
    async list(query) {
      calls.push(query);
      return { docs: [row], page: query.page, totalPages: 3, hasPrevPage: true, hasNextPage: true, prevPage: 1, nextPage: 3 };
    },
    async get(value) { calls.push(value); return value === id ? row : null; },
  };
  const app = createApp({ ...fixtures(), deliveriesService: new Service(repository), nodeEnv: 'test', logger: { log: (level, message, meta) => logs.push({ level, ...meta }) } });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async route => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/deliveries${route}`);
    return { status: r.status, body: await r.json(), id: r.headers.get('x-request-id') };
  };
  const list = await request('?status=pending&page=2&limit=5');
  assert.equal(list.status, 200);
  assert.deepEqual(calls.pop(), { page: 2, limit: 5, status: 'pending' });
  assert.equal(list.body.prevLink, '/api/deliveries?status=pending&page=1&limit=5');
  assert.equal(list.body.nextLink, '/api/deliveries?status=pending&page=3&limit=5');
  assert.ok(!Object.hasOwn(list.body.payload[0], 'driver'));
  assert.deepEqual((await request('/' + id)).body, { status: 'success', payload: row });
  await request('');
  assert.deepEqual(calls.pop(), { page: 1, limit: 10, status: undefined });
  for (const [route, code] of [['/bad-id', 'INVALID_ID'], ['?status=delivered', 'INVALID_DELIVERY_STATUS'], ['?status=pending&status=assigned', 'INVALID_DELIVERY_STATUS'], ['?page=0', 'VALIDATION_ERROR'], ['?limit=101', 'VALIDATION_ERROR'], ['?other=x', 'VALIDATION_ERROR']]) {
    const before = calls.length;
    const result = await request(route);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, code);
    assert.equal(calls.length, before);
    const error = logs.filter(log => log.event === 'http.error' && log.requestId === result.id);
    assert.equal(error.length, 1); assert.equal(error[0].level, 'warning');
  }
  const missing = await request('/ffffffffffffffffffffffff');
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'DELIVERY_NOT_FOUND');
  // Exercise the actual persistence translator through the repository.
  t.mock.method(Delivery, 'find', () => { throw Error('private database details'); });
  repository.list = query => new Repository().list(query);
  const failure = await request('');
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, { status: 'error', error: 'DATABASE_ERROR', message: 'No se pudo completar la operación de persistencia' });
});

test('Entregas: repositorio conserva proyección, orden estable, normalización y páginas vacías', async t => {
  const captured = {};
  const chain = {
    select(x) { captured.select = x; return this; }, sort(x) { captured.sort = x; return this; },
    skip(x) { captured.skip = x; return this; }, limit(x) { captured.limit = x; return this; },
    async lean() { return [{ ...row, _id: { toString: () => id } }]; },
  };
  t.mock.method(Delivery, 'find', filter => { captured.filter = filter; return chain; });
  t.mock.method(Delivery, 'countDocuments', async filter => { assert.deepEqual(filter, captured.filter); return 11; });
  const repository = new Repository();
  const result = await repository.list({ page: 2, limit: 5, status: 'pending' });
  assert.deepEqual(captured, { filter: { status: 'pending' }, select: 'order driver status createdAt updatedAt', sort: { createdAt: -1, _id: 1 }, skip: 5, limit: 5 });
  assert.equal(result.docs[0]._id, id); assert.equal(result.docs[0].id, id);
  assert.equal(result.totalPages, 3); assert.equal(result.prevPage, 1); assert.equal(result.nextPage, 3);
  t.mock.method(Delivery, 'countDocuments', async () => 0);
  t.mock.method(chain, 'lean', async () => []);
  const empty = await repository.list({ page: 1, limit: 10 });
  assert.deepEqual(captured.filter, {});
  assert.equal(empty.totalPages, 1); assert.equal(empty.prevPage, null); assert.equal(empty.nextPage, null);
  assert.equal(empty.hasNextPage, false); assert.equal(empty.hasPrevPage, false);
  t.mock.method(Delivery, 'findById', value => { assert.equal(value, id); return { select(fields) { assert.equal(fields, captured.select); return { lean: async () => row }; } }; });
  assert.deepEqual(await repository.get(id), row);
});
