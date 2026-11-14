const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const Parser = require('@apidevtools/swagger-parser');
const createApp = require('../src/app');
const getSpec = require('../src/docs');
const dictionary = require('../src/errors/error-dictionary');
const OrdersService = require('../src/services/orders.service');
const DeliveriesService = require('../src/services/deliveries.service');
const { fixtures } = require('./helpers/fixtures');
const mockFixtures = require('./helpers/mocks-fixtures');
const spec = getSpec();
const deref = value => value.$ref ? deref(value.$ref.split('/').slice(1).reduce((node, key) => node[key], spec)) : value;
const id = '000000000000000000000001';
const times = { createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z' };

// Check HTTP values and examples against the subset of OAS schemas this API uses.
function shape(value, source) {
  const s = deref(source);
  if (value === null && s.nullable) return;
  for (const part of s.allOf || []) shape(value, part);
  if (s.enum) assert.ok(s.enum.includes(value), `Valor fuera del enum: ${value}`);
  if (s.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    for (const key of s.required || []) assert.ok(Object.hasOwn(value, key), `Falta ${key}`);
    if (s.minProperties) assert.ok(Object.keys(value).length >= s.minProperties);
    for (const [key, child] of Object.entries(value)) {
      if (s.properties?.[key]) shape(child, s.properties[key]);
      else if (s.additionalProperties === false) assert.fail(`Campo adicional: ${key}`);
    }
  }
  if (s.type === 'array') { assert.ok(Array.isArray(value)); if (s.minItems) assert.ok(value.length >= s.minItems); value.forEach(v => shape(v, s.items)); }
  if (s.type === 'string') {
    assert.equal(typeof value, 'string');
    if (s.pattern) assert.match(value, new RegExp(s.pattern));
    if (s.minLength) assert.ok(value.length >= s.minLength);
    if (s.format === 'date-time') assert.ok(Number.isFinite(Date.parse(value)));
  }
  if (s.type === 'boolean') assert.equal(typeof value, 'boolean');
  if (s.type === 'number' || s.type === 'integer') {
    assert.equal(typeof value, 'number'); if (s.type === 'integer') assert.ok(Number.isInteger(value));
    if (s.minimum !== undefined) assert.ok(value >= s.minimum);
    if (s.maximum !== undefined) assert.ok(value <= s.maximum);
  }
}
function checkResponse(route, method, response) {
  const documented = deref(spec.paths[route][method].responses[response.status]);
  assert.match(response.id, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
  shape(response.body, documented.content['application/json'].schema);
  if (response.body.status === 'error') {
    const examples = documented.content['application/json'].examples;
    assert.ok(examples[response.body.error]);
    assert.deepEqual(response.body, examples[response.body.error].value);
    assert.equal(dictionary[response.body.error].status, response.status);
  }
}
async function setup(t, options = {}) {
  const f = fixtures();
  const originalCreate = f.usersRepository.create;
  f.usersRepository.create = async data => Object.assign(await originalCreate(data), times);
  const mocks = mockFixtures(options);
  for (const repo of [mocks.dependencies.usersRepository, mocks.dependencies.ordersRepository, mocks.dependencies.deliveriesRepository]) {
    const insert = repo.insertMany;
    repo.insertMany = async (...args) => (await insert(...args)).map(row => ({ ...row, ...times }));
  }
  const orderId = '000000000000000000000002', deliveryId = '000000000000000000000003';
  const order = { ...require('../src/mocks/orders.generator')(1, { customerIds: [id] })[0], _id: orderId, id: orderId, ...times };
  const delivery = { ...require('../src/mocks/deliveries.generator')(1, { orderIds: [orderId] })[0], _id: deliveryId, id: deliveryId, ...times };
  const repository = row => ({ get: async value => value === row.id ? row : null, list: async ({ page }) => ({ docs: [row], page, totalPages: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null }) });
  const app = createApp({ ...f, mocksService: mocks.service, ordersService: new OrdersService(repository(order)), deliveriesService: new DeliveriesService(repository(delivery)), nodeEnv: options.nodeEnv || 'test' });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, async request(route, method = 'GET', body) {
    const r = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: r.status, body: await r.json(), id: r.headers.get('x-request-id') };
  } };
}

test('OpenAPI: validación completa, refs internas, inventario exacto y ejemplos del diccionario', async () => {
  const snapshot = JSON.stringify(spec);
  await Parser.validate(structuredClone(spec), { resolve: { external: false } });
  assert.equal(JSON.stringify(spec), snapshot);
  assert.equal(getSpec(), spec);
  assert.equal(spec.openapi, '3.0.3'); assert.equal(spec.info.version, require('../package.json').version);
  assert.equal(spec.servers[0].url, '/'); assert.equal(spec.components.securitySchemes, undefined);
  const expected = {
    '/api/users': ['get', 'post'], '/api/users/{uid}': ['get', 'put', 'delete'],
    '/api/orders': ['get'], '/api/orders/{oid}': ['get'], '/api/deliveries': ['get'], '/api/deliveries/{did}': ['get'],
    '/api/mocks/users': ['get', 'post'], '/api/mocks/mockingusers': ['get'], '/api/mocks/mockingdrivers': ['get'],
    '/api/mocks/mockingorders': ['get'], '/api/mocks/mockingdeliveries': ['get'], '/api/mocks/seed': ['post'], '/api/mocks/generateData': ['post'],
    '/loggerTest': ['get'], '/api/health': ['get'],
  };
  assert.deepEqual(Object.keys(spec.paths).sort(), Object.keys(expected).sort());
  const ids = [];
  for (const [route, methods] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(spec.paths[route]).sort(), [...methods].sort());
    for (const method of methods) {
      const op = spec.paths[route][method]; ids.push(op.operationId);
      assert.ok(spec.tags.some(t => t.name === op.tags[0]));
      const params = (op.parameters || []).map(deref).filter(p => p.in === 'path');
      assert.deepEqual(params.map(p => p.name).sort(), [...route.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort());
      assert.ok(params.every(p => p.required));
      for (const [status, source] of Object.entries(op.responses)) {
        const response = deref(source);
        assert.ok(response.headers['X-Request-Id']);
        const content = response.content['application/json'];
        if (content.example) shape(content.example, content.schema);
        for (const [code, example] of Object.entries(content.examples || {})) {
          assert.equal(dictionary[code].status, Number(status));
          assert.equal(example.value.status, 'error'); assert.equal(example.value.error, code);
          assert.equal(typeof example.value.message, 'string');
          if (!['VALIDATION_ERROR', 'INVALID_MOCK_AMOUNT', 'INVALID_MOCK_DATA'].includes(code)) assert.equal(example.value.message, dictionary[code].message);
        }
      }
    }
  }
  assert.equal(ids.length, 19); assert.equal(new Set(ids).size, 19);
  const walk = node => { if (!node || typeof node !== 'object') return; if (node.$ref) assert.ok(node.$ref.startsWith('#/components/')); Object.values(node).forEach(walk); };
  walk(spec);
});

test('OpenAPI: las 19 operaciones responden con los contratos documentados', async t => {
  const api = await setup(t);
  const input = { firstName: 'Alex', lastName: 'Ejemplo', email: 'alex@example.test' };
  const created = await api.request('/api/users', 'POST', input);
  checkResponse('/api/users', 'post', created); assert.equal(created.status, 201);
  const uid = created.body.payload.id;
  for (const [route, method, data, documented] of [
    ['/api/users', 'GET'], ['/api/users/' + uid, 'GET', undefined, '/api/users/{uid}'],
    ['/api/users/' + uid, 'PUT', { firstName: 'Luz' }, '/api/users/{uid}'],
    ['/api/users/' + uid, 'DELETE', undefined, '/api/users/{uid}'],
    ['/api/orders', 'GET'], ['/api/orders/000000000000000000000002', 'GET', undefined, '/api/orders/{oid}'],
    ['/api/deliveries', 'GET'], ['/api/deliveries/000000000000000000000003', 'GET', undefined, '/api/deliveries/{did}'],
    ...['users', 'mockingusers', 'mockingdrivers', 'mockingorders', 'mockingdeliveries'].map(p => ['/api/mocks/' + p + '?qty=2', 'GET']),
    ['/api/mocks/users?qty=1', 'POST'], ['/api/mocks/seed?qty=1', 'POST'],
    ['/api/mocks/generateData', 'POST', { users: 1, drivers: 1, orders: 1, deliveries: 1 }],
    ['/loggerTest', 'GET'], ['/api/health', 'GET'],
  ]) {
    const response = await api.request(route, method, data);
    assert.equal(response.status, method === 'POST' ? 201 : 200, route);
    checkResponse(documented || route.split('?')[0], method.toLowerCase(), response);
    if (method === 'DELETE') assert.equal(response.body.payload.email, input.email);
    if (route === '/api/mocks/generateData') assert.deepEqual(response.body, spec.paths[route].post.responses[201].content['application/json'].example);
    if (route.includes('/api/mocks/') && method === 'GET') for (const row of response.body.payload || response.body) assert.ok(!('_id' in row || 'id' in row || 'createdAt' in row));
  }
});

test('OpenAPI: ejemplos de errores coinciden con HTTP, guard de mocks y producción', async t => {
  const api = await setup(t);
  for (const [route, method, body] of [
    ['/api/orders?status=bad', 'GET'], ['/api/deliveries?status=bad', 'GET'],
    ['/api/mocks/users?qty=-1', 'GET'], ['/api/mocks/generateData', 'POST', '{"users":'],
  ]) { const r = await api.request(route, method, body); assert.equal(r.status, 400); checkResponse(route.split('?')[0], method.toLowerCase(), r); }
  const forbidden = await setup(t, { forbidden: true });
  const blocked = await forbidden.request('/api/mocks/seed?qty=1', 'POST');
  assert.equal(blocked.status, 403); checkResponse('/api/mocks/seed', 'post', blocked);
  const prod = await setup(t, { nodeEnv: 'production' });
  for (const [route, method] of [['/loggerTest', 'GET'], ['/api/mocks/users', 'GET'], ['/api/mocks/seed?qty=1', 'POST']]) {
    const r = await prod.request(route, method); assert.equal(r.status, 404); checkResponse(route.split('?')[0], method.toLowerCase(), r);
  }
});

test('Swagger HTTP: redirección, HTML, assets y script apuntan al mismo JSON en ambos entornos', async t => {
  for (const nodeEnv of ['test', 'production']) {
    const { base } = await setup(t, { nodeEnv });
    const redirect = await fetch(base + '/api/docs', { redirect: 'manual' });
    assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), '/api/docs/');
    const html = await fetch(base + '/api/docs/');
    assert.equal(html.status, 200); assert.ok(html.headers.get('x-request-id'));
    assert.match(await html.text(), /swagger-ui-init\.js/);
    for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']) {
      const r = await fetch(base + '/api/docs/' + asset); assert.equal(r.status, 200); assert.ok((await r.text()).length > 100);
    }
    const js = await (await fetch(base + '/api/docs/swagger-ui-init.js')).text();
    let initialized;
    const bundle = options => { initialized = options; return { initOAuth() {}, preauthorizeApiKey() {} }; };
    bundle.presets = { apis: {} }; bundle.plugins = { DownloadUrl: {} };
    const context = { window: { location: { search: '', origin: base } }, SwaggerUIBundle: bundle, SwaggerUIStandalonePreset: {} };
    vm.runInNewContext(js, context); context.window.onload();
    assert.equal(initialized.url, '/api/docs/openapi.json'); assert.equal(initialized.validatorUrl, null); assert.equal(initialized.spec, undefined);
    const r = await fetch(base + initialized.url);
    assert.equal(r.status, 200); assert.ok(r.headers.get('x-request-id')); assert.deepEqual(await r.json(), spec);
  }
});

test('OpenAPI se resuelve desde otro cwd y no importa modelos ni secretos', () => {
  const modulePath = path.resolve(__dirname, '../src/docs');
  const appPath = path.resolve(__dirname, '../src/app');
  const code = `
    const fs=require('node:fs'); fs.createWriteStream=()=>{throw Error('log prohibido')};
    const get=require(${JSON.stringify(modulePath)}); const s=get();
    if(s.openapi!=='3.0.3'||Object.keys(s.paths).length!==15)process.exitCode=2;
    const server=require('node:http').createServer(require(${JSON.stringify(appPath)})());
    server.listen(0,'127.0.0.1',async()=>{
      try {
        const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/docs/openapi.json');
        if(r.status!==200||(await r.json()).openapi!=='3.0.3')process.exitCode=4;
        if(Object.keys(require.cache).some(p=>/mongoose|env.config/.test(p)))process.exitCode=3;
      } catch {process.exitCode=5;} finally {server.close();}
    });`;
  const child = spawnSync(process.execPath, ['-e', code], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, '');
});
