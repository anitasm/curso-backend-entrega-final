const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createApp = require('../src/app');
const AppError = require('../src/errors/AppError');
const dictionary = require('../src/errors/error-dictionary');
const errors = require('../src/middlewares/errors');
const { fixtures } = require('./helpers/fixtures');
const mocksFixture = require('./helpers/mocks-fixtures');
const OrdersService = require('../src/services/orders.service');
const { persist } = require('../src/repositories/persistence');
const id = 'ffffffffffffffffffffffff';
const secret = 'mongodb://private:credential@host/private C:\\private\\body-secret';

async function setup(t, options = {}) {
  const f = fixtures();
  const mocks = mocksFixture(options);
  const orderCalls = [];
  const ordersRepository = {
    get: async value => { orderCalls.push(value); return null; },
    list: async query => {
      orderCalls.push(query);
      return { docs: [{ id, status: query.status || 'created' }], page: query.page, totalPages: 3, hasPrevPage: query.page > 1, hasNextPage: query.page < 3, prevPage: query.page > 1 ? query.page - 1 : null, nextPage: query.page < 3 ? query.page + 1 : null };
    },
  };
  const app = createApp({ ...f, ordersService: new OrdersService(ordersRepository), mocksService: mocks.service, nodeEnv: 'test' });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, { method = 'GET', body, raw, type = 'application/json' } = {}) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': type }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { status: res.status, body: await res.json() };
  }
  return { ...f, mocks, ordersRepository, orderCalls, request };
}
function expectError(result, code) {
  assert.equal(result.status, dictionary[code].status);
  assert.deepEqual(Object.keys(result.body).sort(), ['error', 'message', 'status']);
  assert.equal(result.body.status, 'error');
  assert.equal(result.body.error, code);
  assert.equal(typeof result.body.message, 'string');
  assert.ok(result.body.message.length > 0);
  assert.ok(!JSON.stringify(result.body).includes(secret));
}

test('Errores HTTP: recursos ausentes, ID inválido y rutas desconocidas', async t => {
  const f = await setup(t);
  for (const [path, code] of [
    ['/api/no-existe', 'ROUTE_NOT_FOUND'], ['/api/users/no-es-id', 'INVALID_ID'],
    [`/api/users/${id}`, 'USER_NOT_FOUND'], [`/api/products/${id}`, 'PRODUCT_NOT_FOUND'],
    [`/api/carts/${id}`, 'CART_NOT_FOUND'], [`/api/orders/${id}`, 'ORDER_NOT_FOUND'],
    ['/api/orders/no-es-id', 'INVALID_ID'],
  ]) expectError(await f.request(path), code);
  assert.deepEqual(f.orderCalls, [id]);
  const cart = await f.cartsService.createCart();
  expectError(await f.request(`/api/carts/${cart.id}/products/${id}`, { method: 'PUT', body: { quantity: 1 } }), 'CART_ITEM_NOT_FOUND');
});

test('Pedidos HTTP: filtros válidos, paginación y validación antes de consultar', async t => {
  const f = await setup(t);
  for (const query of ['status=no-existe', 'status=created&status=assigned', 'status[$ne]=created']) {
    expectError(await f.request('/api/orders?' + query), 'INVALID_ORDER_STATUS');
  }
  for (const query of ['limit=101', 'page=0', 'page=1&page=2', 'unknown=private']) {
    expectError(await f.request('/api/orders?' + query), 'VALIDATION_ERROR');
  }
  assert.deepEqual(f.orderCalls, []);
  const list = await f.request('/api/orders?status=assigned&page=2&limit=5');
  assert.equal(list.status, 200);
  assert.equal(list.body.status, 'success');
  assert.equal(list.body.payload[0].status, 'assigned');
  assert.equal(list.body.page, 2);
  assert.match(list.body.nextLink, /page=3/);
  assert.deepEqual(f.orderCalls, [{ status: 'assigned', page: 2, limit: 5 }]);
  f.ordersRepository.get = async () => ({ id, status: 'created' });
  assert.deepEqual((await f.request(`/api/orders/${id}`)).body, { status: 'success', payload: { id, status: 'created' } });
});

test('Parser HTTP: JSON malformado y límite de 100 KB con respuestas seguras', async t => {
  const f = await setup(t);
  expectError(await f.request('/api/mocks/generateData', { method: 'POST', raw: '{"secret":' }), 'INVALID_JSON');
  expectError(await f.request('/api/mocks/generateData', { method: 'POST', body: { text: 'x'.repeat(110000) } }), 'PAYLOAD_TOO_LARGE');
  assert.deepEqual(f.mocks.calls, []);
});

test('Mocks HTTP: códigos de cantidades y datos, sin tocar persistencia', async t => {
  const f = await setup(t);
  for (const query of ['qty=-1', 'qty=0', 'qty=1.5', 'qty=101', 'qty=x', 'qty=', 'qty=1&qty=2']) {
    expectError(await f.request('/api/mocks/users?' + query), 'INVALID_MOCK_AMOUNT');
    expectError(await f.request('/api/mocks/seed?' + query, { method: 'POST' }), 'INVALID_MOCK_AMOUNT');
  }
  expectError(await f.request('/api/mocks/seed', { method: 'POST' }), 'INVALID_MOCK_AMOUNT');
  for (const body of [{ users: -1 }, { users: '2' }, { users: 1.5 }, {}, { users: 100, drivers: 1 }]) {
    expectError(await f.request('/api/mocks/generateData', { method: 'POST', body }), 'INVALID_MOCK_AMOUNT');
  }
  for (const body of [[], { orders: 1 }, { users: 1, deliveries: 1 }, { unknown: secret }]) {
    expectError(await f.request('/api/mocks/generateData', { method: 'POST', body }), 'INVALID_MOCK_DATA');
  }
  expectError(await f.request('/api/mocks/generateData', { method: 'POST', raw: 'users=1', type: 'text/plain' }), 'INVALID_MOCK_DATA');
  expectError(await f.request('/api/mocks/users?private=value'), 'INVALID_MOCK_DATA');
  assert.deepEqual(f.mocks.calls, []);
});

test('Mocks HTTP: base prohibida, error definitivo y conflictos controlados', async t => {
  const forbidden = await setup(t, { forbidden: true });
  expectError(await forbidden.request('/api/mocks/seed?qty=1', { method: 'POST' }), 'MOCK_DATABASE_FORBIDDEN');
  assert.deepEqual(forbidden.mocks.calls, ['guard']);
  const f = await setup(t, { failDeliveries: true });
  expectError(await f.request('/api/mocks/generateData', { method: 'POST', body: { users: 1, orders: 1, deliveries: 1 } }), 'MOCK_GENERATION_ERROR');
  assert.equal(f.mocks.committed(), false);
  assert.equal(f.mocks.calls.at(-1), 'abort');
  for (const [failure, code] of [
    [new AppError('MOCK_TRANSACTIONS_REQUIRED', { cause: new Error(secret) }), 'MOCK_TRANSACTIONS_REQUIRED'],
    [Object.assign(new Error(secret), { code: 11000, keyPattern: { email: 1 } }), 'USER_ALREADY_EXISTS'],
    [Object.assign(new Error(secret), { code: 11000, keyPattern: { order: 1 } }), 'DUPLICATE_KEY'],
  ]) {
    f.mocks.service.withTransaction = async () => { throw failure; };
    expectError(await f.request('/api/mocks/seed?qty=1', { method: 'POST' }), code);
  }
});

test('Errores HTTP: duplicado y fallos de persistencia no filtran detalles', async t => {
  const f = await setup(t);
  const profile = { firstName: 'Ana', lastName: 'Ejemplo', email: 'ana@example.test' };
  assert.equal((await f.request('/api/users', { method: 'POST', body: profile })).status, 201);
  expectError(await f.request('/api/users', { method: 'POST', body: profile }), 'USER_ALREADY_EXISTS');
  f.usersRepository.list = () => persist(async () => { throw new Error(secret); });
  expectError(await f.request('/api/users'), 'DATABASE_ERROR');
  for (const failure of [Object.assign(new Error(secret), { status: 401, code: 'USER_NOT_FOUND' }), new AppError('DATABASE_ERROR', { message: secret, cause: new Error(secret) })]) {
    // Even a mutated controlled 5xx message must never reach HTTP.
    failure.message = secret;
    f.usersRepository.list = async () => { throw failure; };
    expectError(await f.request('/api/users'), failure instanceof AppError ? 'DATABASE_ERROR' : 'INTERNAL_SERVER_ERROR');
  }
});

test('Diccionario inmutable, causa interna y delegación cuando headersSent', () => {
  assert.ok(Object.isFrozen(dictionary));
  for (const entry of Object.values(dictionary)) assert.ok(Object.isFrozen(entry));
  assert.throws(() => new AppError('INVENTED'), TypeError);
  const cause = new Error(secret);
  const error = new AppError('DATABASE_ERROR', { cause, message: secret });
  assert.equal(error.cause, cause);
  assert.equal(error.name, 'AppError');
  assert.equal(error.message, dictionary.DATABASE_ERROR.message);
  let forwarded;
  errors(error, {}, { headersSent: true, status: () => assert.fail('No debe escribir') }, value => { forwarded = value; });
  assert.equal(forwarded, error);
});
