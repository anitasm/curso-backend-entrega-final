const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createApp = require('../src/app');
const { fixtures } = require('./helpers/fixtures');
const mockFixtures = require('./helpers/mocks-fixtures');
const { USER_ROLES } = require('../src/constants');

async function setup(t, { nodeEnv = 'test', withoutService = false, ...options } = {}) {
  const mocks = mockFixtures(options);
  const app = createApp({ ...fixtures(), mocksService: withoutService ? undefined : mocks.service, nodeEnv });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (route, { method = 'GET', body, raw, type = 'application/json' } = {}) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
      method, headers: { 'Content-Type': type }, body: raw === undefined ? body === undefined ? undefined : JSON.stringify(body) : raw,
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...mocks, request };
}

test('HTTP mocks: ambos formatos de usuarios, drivers y previews sin escrituras', async t => {
  const f = await setup(t, { nodeEnv: 'development' });
  const simple = await f.request('/api/mocks/users?qty=2');
  assert.equal(simple.status, 200);
  assert.equal(simple.body.length, 2);
  assert.deepEqual(simple.body.map(user => user.rol), ['cliente', 'repartidor']);
  for (const user of simple.body) {
    assert.deepEqual(Object.keys(user).sort(), ['email', 'nombre', 'rol']);
    assert.match(user.nombre, / /);
  }
  const full = await f.request('/api/mocks/mockingusers?qty=2');
  assert.equal(full.status, 200);
  assert.equal(full.body.status, 'success');
  assert.equal(full.body.payload.length, 2);
  for (const user of full.body.payload) assert.deepEqual(Object.keys(user).sort(), ['email', 'firstName', 'lastName', 'role']);
  assert.deepEqual(full.body.payload.map(user => user.role), [USER_ROLES.USER, USER_ROLES.DRIVER]);
  const drivers = await f.request('/api/mocks/mockingdrivers?qty=1');
  assert.equal(drivers.status, 200);
  assert.equal(drivers.body.payload[0].role, USER_ROLES.DRIVER);
  for (const route of ['mockingorders', 'mockingdeliveries']) {
    const result = await f.request('/api/mocks/' + route + '?qty=2');
    assert.equal(result.status, 200); assert.equal(result.body.payload.length, 2);
    assert.equal((await f.request('/api/mocks/' + route)).body.payload.length, 10);
  }
  assert.equal((await f.request('/api/mocks/users')).body.length, 10);
  assert.equal((await f.request('/api/mocks/mockingusers')).body.payload.length, 10);
  assert.deepEqual(f.calls, []);
});

test('HTTP mocks: límites, parámetros repetidos y campos desconocidos dan 400', async t => {
  const f = await setup(t);
  for (const query of ['qty=0', 'qty=101', 'qty=-1', 'qty=1.5', 'qty=', 'qty=2e1', 'qty=1&qty=2', 'qty[]=2', 'qty[x]=2', 'qty=2&extra=1']) {
    assert.equal((await f.request('/api/mocks/users?' + query)).status, 400, query);
    assert.equal((await f.request('/api/mocks/seed?' + query, { method: 'POST' })).status, 400, query);
  }
  assert.equal((await f.request('/api/mocks/seed', { method: 'POST' })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('HTTP mocks: seed y generateData respetan envelopes y conteos', async t => {
  const f = await setup(t);
  const seed = await f.request('/api/mocks/seed?qty=10', { method: 'POST' });
  assert.equal(seed.status, 201);
  assert.deepEqual(seed.body, { insertados: 10, coleccion: 'usuarios' });
  const body = { users: 2, drivers: 1, orders: 2, deliveries: 2 };
  const generated = await f.request('/api/mocks/generateData', { method: 'POST', body });
  assert.equal(generated.status, 201);
  assert.deepEqual(generated.body, { status: 'success', payload: { insertados: body } });
  const noDriver = await f.request('/api/mocks/generateData', { method: 'POST', body: { users: 1, orders: 1, deliveries: 1 } });
  assert.equal(noDriver.status, 201);
  assert.equal(noDriver.body.payload.insertados.drivers, 0);
});

test('HTTP mocks: JSON inválido, tipo incorrecto y dependencias incoherentes', async t => {
  const f = await setup(t);
  const route = '/api/mocks/generateData';
  for (const body of [{}, [], null, { users: '2' }, { users: 1, password: 'x' }, { orders: 1 }, { users: 1, orders: 1, deliveries: 2 }, { users: 100, drivers: 1 }]) {
    assert.equal((await f.request(route, { method: 'POST', body })).status, 400);
  }
  assert.equal((await f.request(route, { method: 'POST', raw: '{invalid' })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', raw: 'users=1', type: 'application/x-www-form-urlencoded' })).status, 400);
  assert.equal((await f.request(route + '?qty=1', { method: 'POST', body: { users: 1 } })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('HTTP mocks: production o servicio ausente responden 404', async t => {
  for (const options of [{ nodeEnv: 'production' }, { withoutService: true }]) {
    const f = await setup(t, options);
    for (const route of ['users', 'mockingusers', 'mockingdrivers', 'mockingorders', 'mockingdeliveries']) assert.equal((await f.request('/api/mocks/' + route)).status, 404);
    assert.equal((await f.request('/api/mocks/seed?qty=1', { method: 'POST' })).status, 404);
    assert.equal((await f.request('/api/mocks/generateData', { method: 'POST', body: { users: 1 } })).status, 404);
    assert.deepEqual(f.calls, []);
  }
});

test('HTTP mocks: base habitual bloquea POST con 403, GET disponible', async t => {
  const f = await setup(t, { forbidden: true });
  assert.equal((await f.request('/api/mocks/users?qty=2')).status, 200);
  assert.equal((await f.request('/api/mocks/seed?qty=1', { method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/mocks/generateData', { method: 'POST', body: { users: 1 } })).status, 403);
  assert.deepEqual(f.calls, ['guard', 'guard']);
});

test('HTTP mocks: falla final no responde éxito y Users conserva sus restricciones', async t => {
  const f = await setup(t, { failDeliveries: true });
  const failed = await f.request('/api/mocks/generateData', { method: 'POST', body: { users: 1, orders: 1, deliveries: 1 } });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { status: 'error', message: 'Error interno del servidor' });
  assert.equal(f.committed(), false);
  const profile = { firstName: 'Test', lastName: 'Ejemplo', email: 'new@example.test' };
  assert.equal((await f.request('/api/users', { method: 'POST', body: { ...profile, role: USER_ROLES.DRIVER } })).status, 400);
  const publicUser = await f.request('/api/users', { method: 'POST', body: profile });
  assert.equal(publicUser.status, 201);
  assert.equal(publicUser.body.payload.role, USER_ROLES.USER);
  assert.equal((await f.request('/api/users/' + publicUser.body.payload.id, { method: 'PUT', body: { role: USER_ROLES.DRIVER } })).status, 400);
});

test('Clase 2: health informa disponibilidad HTTP sin usar mocks', async t => {
  const f = await setup(t);
  const result = await f.request('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'ok');
  assert.equal(new Date(result.body.timestamp).toISOString(), result.body.timestamp);
  assert.deepEqual(f.calls, []);
});

test('Clase 2: POST mocks/users devuelve perfiles confirmados y default compartido', async t => {
  const { MOCKING_PARAMETERS } = require('../src/constants');
  const f = await setup(t);
  const result = await f.request('/api/mocks/users?qty=2', { method: 'POST' });
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'success');
  assert.equal(result.body.payload.inserted, 2);
  assert.equal(result.body.payload.collection, 'users');
  assert.deepEqual(result.body.payload.users.map(user => user.role), [USER_ROLES.USER, USER_ROLES.DRIVER]);
  assert.ok(result.body.payload.users.every(user => /^[a-f0-9]{24}$/.test(user.id) && !('password' in user)));
  assert.deepEqual(result.body.payload.users, f.batches[0].rows);
  assert.equal(f.committed(), true);
  const defaults = await f.request('/api/mocks/users', { method: 'POST' });
  assert.equal(defaults.status, 201);
  assert.equal(defaults.body.payload.inserted, MOCKING_PARAMETERS.DEFAULT);
});

test('Clase 2: nuevo POST conserva validación, base dedicada y exclusión en production', async t => {
  const f = await setup(t);
  for (const query of ['qty=0', 'qty=101', 'qty=1&qty=2', 'qty=1&extra=x']) {
    assert.equal((await f.request('/api/mocks/users?' + query, { method: 'POST' })).status, 400);
  }
  assert.deepEqual(f.calls, []);
  const forbidden = await setup(t, { forbidden: true });
  assert.equal((await forbidden.request('/api/mocks/users?qty=2', { method: 'POST' })).status, 403);
  assert.deepEqual(forbidden.calls, ['guard']);
  const production = await setup(t, { nodeEnv: 'production' });
  assert.equal((await production.request('/api/mocks/users?qty=2', { method: 'POST' })).status, 404);
  assert.deepEqual(production.calls, []);
});
