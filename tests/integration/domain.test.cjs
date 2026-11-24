const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const mongoose = require('mongoose');
const request = require('supertest');
const createApp = require('../../src/app');
const User = require('../../src/models/User'), Order = require('../../src/models/Order'), Delivery = require('../../src/models/Delivery');
const ProductsRepository = require('../../src/repositories/products.repository');
const UsersRepository = require('../../src/repositories/users.repository');
const OrdersRepository = require('../../src/repositories/orders.repository');
const DeliveriesRepository = require('../../src/repositories/deliveries.repository');
const UsersService = require('../../src/services/users.service');
const OrdersService = require('../../src/services/orders.service');
const DeliveriesService = require('../../src/services/deliveries.service');
const MocksService = require('../../src/services/mocks.service');
const createMocks = require('../../src/repositories/mock-transaction');
const { createLogger } = require('../../src/utils/logger');
const { logEvent } = require('../../src/utils/log-events');
const missing = 'ffffffffffffffffffffffff';
const pdf = Buffer.from('%PDF-1.4\nFictitious integration fixture\n%%EOF');
const input = customer => ({ customer, items: [{ name: 'Prueba', quantity: 2, price: 10 }], deliveryAddress: 'Dirección ficticia 100' });
let api, root, logger, users, orders, deliveries, mocks, repositories, withTransaction;
let serial = 0;
const profile = async (role = 'user') => (await api.post('/api/users').send({ firstName: 'Test', lastName: 'Ficticio', email: 'test' + (++serial) + '@example.test', role }).expect(201)).body.payload;
const order = async customer => (await api.post('/api/orders').send(input(customer || (await profile()).id)).expect(201)).body.payload;
const state = async id => Order.findById(id).select('+history +historyComplete +revision +deletedAt').lean();
const fail = (response, status, code) => { assert.equal(response.status, status, JSON.stringify(response.body)); assert.equal(response.body.error, code); };
describe('MongoDB real: contratos HTTP, transacciones y persistencia', function () {
  this.timeout(30000);
  before(async () => {
    const uri = process.env.TEST_MONGODB_URI;
    if (!uri || process.env.NODE_ENV !== 'test' || new URL(uri).pathname !== '/shipnow_test') throw new Error('Explicit test-only MongoDB URI required');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    if (mongoose.connection.db.databaseName !== 'shipnow_test') throw new Error('Refusing to write outside shipnow_test');
    const { expect } = await import('chai');
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }); expect(hello.setName).to.equal('rs0'); assert.equal(hello.isWritablePrimary, true);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shipnow-integration-'));
    logger = createLogger({ nodeEnv: 'test', logDir: path.join(root, 'logs') });
    const usersRepository = new UsersRepository(), ordersRepository = new OrdersRepository(), deliveriesRepository = new DeliveriesRepository();
    repositories = { usersRepository, ordersRepository, deliveriesRepository };
    await Promise.all([User.init(), Order.init(), Delivery.init(), new ProductsRepository().initialize()]);
    withTransaction = require('../../src/repositories/unit-of-work')();
    orders = new OrdersService(ordersRepository, usersRepository, { deliveriesRepository, withTransaction });
    deliveries = new DeliveriesService(deliveriesRepository, { ordersService: orders, usersRepository, withTransaction });
    users = new UsersService(usersRepository, { ordersRepository, deliveriesRepository, withTransaction });
    mocks = new MocksService({ ...repositories, ...createMocks(mongoose.connection, { nodeEnv: 'test' }), logger });
    const productsService = new (require('../../src/services/products.service'))(new ProductsRepository());
    const cartsService = new (require('../../src/services/carts.service'))(new (require('../../src/repositories/carts.repository'))(), productsService);
    api = request(createApp({ usersService: users, ordersService: orders, deliveriesService: deliveries, mocksService: mocks, productsService, cartsService, nodeEnv: 'test', logger, uploadRoot: path.join(root, 'uploads') }));
  });
  beforeEach(async () => {
    assert.equal(mongoose.connection.db.databaseName, 'shipnow_test');
    for (const model of [Delivery, Order, User]) await model.deleteMany({});
  });
  after(async () => { if (logger) await logger.shutdown(); await mongoose.disconnect(); if (root) await fs.rm(root, { recursive: true, force: true }); });
  it('crea perfiles user/driver, rechaza admin y mantiene rol inmutable', async () => {
    const a = await profile(), d = await profile('driver'); assert.equal(a.role, 'user'); assert.equal(d.role, 'driver');
    fail(await api.post('/api/users').send({ firstName: 'A', lastName: 'B', email: 'a@example.test', role: 'admin' }), 400, 'VALIDATION_ERROR');
    fail(await api.put('/api/users/' + a.id).send({ role: 'driver' }), 400, 'VALIDATION_ERROR');
    fail(await api.post('/api/users').send({ firstName: 'A', lastName: 'B', email: a.email }), 409, 'USER_ALREADY_EXISTS');
    await api.delete('/api/users/' + d.id).expect(200); assert.equal(await User.findById(d.id), null);
  });
  it('edita items y total juntos; valida límites antes de persistir; oculta datos internos', async () => {
    const a = await profile(), o = await order(a.id);
    assert.equal(o.total, 20); assert.equal(o.history, undefined); assert.equal(o.revision, undefined);
    const update = await api.put('/api/orders/' + o.id).send({ items: [{ name: 'Nuevo', quantity: 3, price: 5 }], priority: 'high' }).expect(200);
    assert.equal(update.body.payload.total, 15); assert.equal((await state(o.id)).items[0].name, 'Nuevo');
    for (const data of [{}, { customer: a.id }, { total: 0 }, { items: [] }, { items: Array(101).fill({ name: 'A', quantity: 1, price: 1 }) }, { items: [{ name: 'A', quantity: '1', price: 1 }] }, { deliveryAddress: 'a'.repeat(501) }]) fail(await api.put('/api/orders/' + o.id).send(data), 400, 'VALIDATION_ERROR');
    assert.equal((await state(o.id)).total, 15);
    await api.post('/api/orders').send({ ...input(a.id), items: Array(100).fill({ name: 'A', quantity: 1, price: 1 }) }).expect(201);
    fail(await api.post('/api/orders').send(input((await profile('driver')).id)), 400, 'VALIDATION_ERROR');
    fail(await api.post('/api/orders').send(input(missing)), 404, 'USER_NOT_FOUND');
  });
  it('entrega pendiente, asignación, seguimiento completo e idempotencia', async () => {
    const o = await order(), d = await profile('driver');
    const delivery = (await api.post('/api/deliveries').send({ order: o.id }).expect(201)).body.payload;
    assert.equal((await state(o.id)).status, 'created'); assert.equal(delivery.status, 'pending');
    fail(await api.patch('/api/orders/' + o.id + '/status').send({ status: 'assigned' }), 409, 'INVALID_ORDER_TRANSITION');
    await api.patch('/api/deliveries/' + delivery.id + '/driver').send({ driver: d.id }).expect(200);
    assert.equal((await state(o.id)).status, 'assigned');
    fail(await api.put('/api/orders/' + o.id).send({ priority: 'normal' }), 409, 'ORDER_NOT_EDITABLE');
    fail(await api.delete('/api/orders/' + o.id), 409, 'ORDER_NOT_DELETABLE');
    fail(await api.patch('/api/deliveries/' + delivery.id + '/driver').send({ driver: d.id }), 409, 'INVALID_DELIVERY_ASSIGNMENT');
    fail(await api.post('/api/deliveries').send({ order: o.id }), 409, 'DELIVERY_ALREADY_EXISTS');
    for (const status of ['picked_up', 'in_transit', 'delivered']) await api.patch('/api/orders/' + o.id + '/status').send({ status }).expect(200);
    const before = await state(o.id);
    await api.patch('/api/orders/' + o.id + '/status').send({ status: 'delivered' }).expect(200);
    const after = await state(o.id); assert.deepEqual(after.history, before.history); assert.equal(after.revision, before.revision);
    fail(await api.patch('/api/orders/' + o.id + '/status').send({ status: 'created' }), 409, 'INVALID_ORDER_TRANSITION');
    fail(await api.patch('/api/orders/' + o.id + '/status').send({ status: 'unknown' }), 400, 'INVALID_ORDER_STATUS');
    const tracking = (await api.get('/api/orders/' + o.id + '/tracking').expect(200)).body.payload;
    assert.deepEqual(Object.keys(tracking).sort(), ['history', 'historyComplete', 'orderId', 'status']);
    assert.equal(tracking.historyComplete, true); assert.deepEqual(tracking.history.map(e => e.status), ['created', 'assigned', 'picked_up', 'in_transit', 'delivered']);
    assert.ok(tracking.history.every(e => e.source === 'actual' && Number.isFinite(Date.parse(e.timestamp))));
    fail(await api.delete('/api/users/' + d.id), 409, 'USER_IN_USE');
  });
  it('asigna al crear y rechaza conductores ausentes o incompatibles sin escrituras parciales', async () => {
    const o = await order(), driver = await profile('driver'), user = await profile();
    fail(await api.post('/api/deliveries').send({ order: o.id, driver: user.id }), 400, 'INVALID_DRIVER_ROLE');
    fail(await api.post('/api/deliveries').send({ order: o.id, driver: missing }), 404, 'USER_NOT_FOUND');
    assert.equal(await Delivery.countDocuments(), 0); assert.equal((await state(o.id)).status, 'created');
    await api.post('/api/deliveries').send({ order: o.id, driver: driver.id }).expect(201);
    assert.equal((await state(o.id)).status, 'assigned'); assert.equal((await Delivery.findOne()).status, 'assigned');
    assert.ok((await Delivery.collection.indexes()).some(i => i.unique && i.key.order === 1));
  });
  it('baja lógica oculta el pedido y conserva referencias históricas; legado no inventa historial', async () => {
    const user = await profile(), o = await order(user.id);
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(o.id) }, { $unset: { history: '', historyComplete: '', revision: '' } });
    const tracking = (await api.get('/api/orders/' + o.id + '/tracking').expect(200)).body.payload;
    assert.equal(tracking.historyComplete, false); assert.deepEqual(tracking.history, []);
    assert.deepEqual((await api.delete('/api/orders/' + o.id).expect(200)).body.payload, { id: o.id, deleted: true });
    assert.ok((await state(o.id)).deletedAt);
    for (const suffix of ['', '/tracking']) fail(await api.get('/api/orders/' + o.id + suffix), 404, 'ORDER_NOT_FOUND');
    fail(await api.put('/api/orders/' + o.id).send({ priority: 'normal' }), 404, 'ORDER_NOT_FOUND');
    fail(await api.post('/api/deliveries').send({ order: o.id }), 404, 'ORDER_NOT_FOUND');
    assert.equal((await api.get('/api/orders').expect(200)).body.payload.length, 0);
    fail(await api.delete('/api/users/' + user.id), 409, 'USER_IN_USE');
  });
  it('operaciones simultáneas incompatibles conservan una sola transición', async () => {
    const o = await order(), d = await profile('driver');
    await api.post('/api/deliveries').send({ order: o.id, driver: d.id }).expect(201);
    const results = await Promise.all(['picked_up', 'cancelled'].map(status => api.patch('/api/orders/' + o.id + '/status').send({ status })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await state(o.id)).history.length, 3);
  });
  it('carrera entre baja de pedido y creación de entrega nunca deja una referencia inválida', async () => {
    const o = await order();
    const results = await Promise.all([api.delete('/api/orders/' + o.id), api.post('/api/deliveries').send({ order: o.id })]);
    assert.equal(results.filter(r => r.status < 300).length, 1);
    const stored = await state(o.id), linked = await Delivery.findOne({ order: o.id });
    assert.ok(stored.deletedAt ? !linked : linked);
  });
  it('carrera entre baja de cliente y alta de pedido no produce huérfanos', async () => {
    const user = await profile();
    const results = await Promise.all([api.delete('/api/users/' + user.id), api.post('/api/orders').send(input(user.id))]);
    assert.equal(results.filter(r => r.status < 300).length, 1);
    const referenced = await Order.findOne({ customer: user.id });
    if (referenced) assert.ok(await User.findById(user.id)); else assert.equal(await User.findById(user.id), null);
  });
  it('dos asignaciones simultáneas eligen un solo conductor y una sola entrada de historial', async () => {
    const o = await order(), a = await profile('driver'), b = await profile('driver');
    const delivery = (await api.post('/api/deliveries').send({ order: o.id }).expect(201)).body.payload;
    const responses = await Promise.all([a, b].map(d => api.patch('/api/deliveries/' + delivery.id + '/driver').send({ driver: d.id })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const saved = await Delivery.findById(delivery.id); assert.ok([a.id, b.id].includes(String(saved.driver)));
    assert.equal((await state(o.id)).history.length, 2);
  });
  it('baja de conductor compite con asignación sin crear referencias huérfanas', async () => {
    const o = await order(), d = await profile('driver');
    const responses = await Promise.all([api.delete('/api/users/' + d.id), api.post('/api/deliveries').send({ order: o.id, driver: d.id })]);
    assert.equal(responses.filter(r => r.status < 300).length, 1);
    const delivery = await Delivery.findOne({ order: o.id });
    if (delivery) assert.ok(await User.findById(delivery.driver)); else assert.equal((await state(o.id)).status, 'created');
  });
  it('rollback real revierte el estado de Order y Delivery tras fallo después de escribir', async () => {
    const o = await order(), d = await profile('driver');
    const repo = repositories.deliveriesRepository, original = repo.create;
    repo.create = async (...args) => { await original.apply(repo, args); throw new Error('Injected after real insert'); };
    try { fail(await api.post('/api/deliveries').send({ order: o.id, driver: d.id }), 500, 'DATABASE_ERROR'); }
    finally { repo.create = original; }
    assert.equal(await Delivery.countDocuments(), 0); const persisted = await state(o.id);
    assert.equal(persisted.status, 'created'); assert.equal(persisted.history.length, 1);
  });
  it('rollback de asignación revierte ambas entidades tras actualizar Delivery', async () => {
    const o = await order(), d = await profile('driver');
    const delivery = (await api.post('/api/deliveries').send({ order: o.id }).expect(201)).body.payload;
    const repo = repositories.deliveriesRepository, original = repo.assign;
    repo.assign = async (...args) => { await original.apply(repo, args); throw new Error('After real update'); };
    try { await api.patch('/api/deliveries/' + delivery.id + '/driver').send({ driver: d.id }).expect(500); }
    finally { repo.assign = original; }
    assert.equal((await Delivery.findById(delivery.id)).status, 'pending'); assert.equal((await state(o.id)).status, 'created');
    assert.equal((await state(o.id)).history.length, 1);
  });
  it('dos cargas concurrentes conservan ambos documentos y comprobantes, sin exposición pública', async () => {
    const user = await profile(), o = await order(user.id), delivery = (await api.post('/api/deliveries').send({ order: o.id }).expect(201)).body.payload;
    for (const [route, field, model, id, property] of [['/api/users/' + user.id + '/documents', 'document', User, user.id, 'documents'], ['/api/deliveries/' + delivery.id + '/proof', 'proof', Delivery, delivery.id, 'proofs']]) {
      const upload = () => { let req = api.post(route); if (field === 'document') req = req.field('type', 'user_document'); return req.attach(field, pdf, { filename: 'ficticio.pdf', contentType: 'application/pdf' }); };
      const responses = await Promise.all([upload(), upload()]); assert.ok(responses.every(r => r.status === 201));
      const row = await model.findById(id).select('+' + property).lean(); assert.equal(row[property].length, 2);
      assert.notEqual(row[property][0].filename, row[property][1].filename);
      for (const file of row[property]) { assert.deepEqual(await fs.readFile(path.join(root, file.path)), pdf); await api.get('/' + file.path).expect(404); }
      assert.equal((await api.get(route.replace(/\/(documents|proof)$/, '')).expect(200)).body.payload[property], undefined);
    }
  });
  it('rechaza cargas vacías, tipo y tamaño incorrectos sin crear metadatos', async () => {
    const user = await profile(), route = '/api/users/' + user.id + '/documents';
    for (const [bytes, status] of [[Buffer.alloc(0), 415], [Buffer.from('invalid'), 415], [Buffer.concat([pdf, Buffer.alloc(5242880)]), 413]]) {
      const result = await api.post(route).field('type', 'user_document').attach('document', bytes, { filename: 'ficticio.pdf', contentType: 'application/pdf' }); assert.equal(result.status, status);
    }
    const stored = await User.findById(user.id).select('+documents'); assert.equal(stored.documents, undefined);
  });
  it('mocks reales relacionan documentos, rollback completo y guardia de base efectiva', async () => {
    const result = await mocks.generateData({ users: 1, drivers: 1, orders: 1, deliveries: 1 }); assert.equal(result.deliveries, 1);
    const delivery = await Delivery.findOne(), o = await Order.findById(delivery.order); assert.equal(o.status, 'assigned'); assert.equal((await User.findById(delivery.driver)).role, 'driver');
    assert.equal((await orders.tracking(String(o._id))).historyComplete, false);
    const original = repositories.deliveriesRepository.insertMany;
    repositories.deliveriesRepository.insertMany = async (...args) => { await original.apply(repositories.deliveriesRepository, args); throw new Error('After real write'); };
    try { await assert.rejects(mocks.generateData({ users: 1, orders: 1, deliveries: 1 }), { code: 'MOCK_GENERATION_ERROR' }); } finally { repositories.deliveriesRepository.insertMany = original; }
    assert.equal(await Order.countDocuments(), 1); assert.equal(await User.countDocuments(), 2); assert.equal(await Delivery.countDocuments(), 1);
    assert.throws(() => createMocks(mongoose.connection).assertMockDatabase(), { code: 'MOCK_DATABASE_FORBIDDEN' });
    assert.throws(() => createMocks(mongoose.connection, { nodeEnv: 'production' }).assertMockDatabase(), { code: 'MOCK_DATABASE_FORBIDDEN' });
  });
  it('salud, Swagger y archivos estáticos; producción oculta diagnósticos y mocks', async () => {
    const prod = request(createApp({ usersService: users, ordersService: orders, deliveriesService: deliveries, mocksService: mocks, nodeEnv: 'production', logger }));
    assert.equal((await prod.get('/api/health').expect(200)).body.environment, 'production');
    await prod.get('/api/docs/').expect(200); await prod.get('/api/docs/openapi.json').expect(200);
    await prod.get('/loggerTest').expect(404); await prod.post('/api/mocks/seed?qty=1').expect(404);
    const paths = await fs.readdir(path.resolve(__dirname, '../../src/public/img/catalog-legacy')); assert.equal(paths.length, 5);
    await prod.get('/img/uploads/' + paths[0]).expect(200);
  });
  it('registra eventos en archivos JSON reales y los vacía al cerrar', async () => {
    const dir = path.join(root, 'isolated-logs'), log = createLogger({ nodeEnv: 'production', logLevel: 'fatal', logDir: dir });
    logEvent('error', 'http.error', { code: 'DATABASE_ERROR' }, log); logEvent('fatal', 'logger.test', { synthetic: true }, log); await log.shutdown();
    const rows = name => fs.readFile(path.join(dir, name), 'utf8').then(s => s.trim().split('\n').map(JSON.parse));
    assert.deepEqual((await rows('error.log')).map(r => r.level), ['error', 'fatal']); assert.deepEqual((await rows('combined.log')).map(r => r.level), ['fatal']);
  });
});
