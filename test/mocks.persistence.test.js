const { test } = require('node:test');
const assert = require('node:assert/strict');
const createMockPersistence = require('../src/repositories/mock-transaction');
const { MOCK_DATABASE_NAME } = require('../src/config/mocks.config');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Delivery = require('../src/models/Delivery');
const UsersRepository = require('../src/repositories/users.repository');
const OrdersRepository = require('../src/repositories/orders.repository');
const DeliveriesRepository = require('../src/repositories/deliveries.repository');
const generateOrders = require('../src/mocks/orders.generator');
const generateDeliveries = require('../src/mocks/deliveries.generator');
const constants = require('../src/constants');
const { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } = constants;
const id = '1234567890abcdef12345678';

test('Infraestructura mocks: comprueba nombre real de base y conexión activa', async () => {
  for (const connection of [
    { readyState: 1, name: MOCK_DATABASE_NAME, db: { databaseName: 'catalogo_habitual' } },
    { readyState: 0, db: { databaseName: MOCK_DATABASE_NAME } },
    { readyState: 1 },
  ]) {
    const infrastructure = createMockPersistence(connection);
    assert.throws(() => infrastructure.assertMockDatabase(), { status: 403 });
    await assert.rejects(infrastructure.withTransaction(() => { throw new Error('No debe ejecutarse'); }), { status: 403 });
  }
  const infrastructure = createMockPersistence({ readyState: 1, db: { databaseName: MOCK_DATABASE_NAME } });
  assert.doesNotThrow(() => infrastructure.assertMockDatabase());
});

test('Repositorios de lote: insertMany validado, misma sesión y errores sin traducir', async t => {
  const session = { example: true };
  for (const [Model, Repository] of [[User, UsersRepository], [Order, OrdersRepository], [Delivery, DeliveriesRepository]]) {
    const error = Object.assign(new Error('transient'), { errorLabels: ['TransientTransactionError'] });
    let calls = 0;
    t.mock.method(Model, 'insertMany', async (data, options) => {
      calls++;
      assert.deepEqual(options, { session, ordered: true });
      assert.equal(data.length, 1);
      if (calls === 1) return [{ _id: id }];
      throw error;
    });
    const repository = new Repository();
    assert.deepEqual(await repository.insertMany([{}], session), [{ _id: id, id }]);
    await assert.rejects(repository.insertMany([{}], session), received => received === error);
  }
});

test('Transacción: conserva etiquetas durante callback y entrega resultado tras commit', async () => {
  const session = { example: true };
  const error = Object.assign(new Error('transient private detail'), { errorLabels: ['TransientTransactionError'] });
  let attempts = 0;
  let committed = false;
  const infrastructure = createMockPersistence({
    readyState: 1, db: { databaseName: MOCK_DATABASE_NAME },
    transaction: async work => {
      await assert.rejects(work(session), received => received === error && received.errorLabels.includes('TransientTransactionError'));
      const result = await work(session);
      committed = true;
      return result;
    },
  });
  const result = await infrastructure.withTransaction(receivedSession => {
    assert.equal(receivedSession, session);
    if (++attempts === 1) throw error;
    assert.equal(committed, false);
    return { insertados: 2 };
  });
  assert.equal(committed, true); assert.equal(attempts, 2);
  assert.deepEqual(result, { insertados: 2 });
});

test('Transacción: falla definitiva, duplicados y standalone se traducen al salir', async () => {
  for (const [error, expected] of [
    [new Error('private detail'), { status: 500 }],
    [{ code: 11000, keyPattern: { email: 1 } }, { status: 409 }],
    [{ code: 20, message: 'Transaction numbers are only allowed on a replica set member or mongos' }, { status: 503 }],
  ]) {
    const infrastructure = createMockPersistence({ readyState: 1, db: { databaseName: MOCK_DATABASE_NAME }, transaction: async () => { throw error; } });
    await assert.rejects(infrastructure.withTransaction(() => {}), received => {
      assert.equal(received.status, expected.status);
      assert.doesNotMatch(received.message, /private detail/);
      if (expected.status === 503) assert.match(received.message, /Atlas o un replica set/);
      return true;
    });
  }
});

test('Modelos logísticos: colecciones, enums, items, totales y coherencia de entrega', async () => {
  assert.equal(User.collection.name, 'users');
  assert.equal(Order.collection.name, 'orders');
  assert.equal(Delivery.collection.name, 'deliveries');
  for (const value of Object.values(constants)) assert.ok(Object.isFrozen(value));
  assert.deepEqual(Object.values(ORDER_STATUS), ['created', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled']);
  const order = generateOrders(1, { customerIds: [id] })[0];
  await new Order(order).validate();
  for (const patch of [{ items: [] }, { total: order.total + 1 }, { status: 'unknown' }, { priority: 'unknown' }, { items: [{ name: 'Test', quantity: 1.5, price: 2 }] }, { items: [{ name: 'Test', quantity: 1, price: -1 }] }]) {
    await assert.rejects(new Order({ ...order, ...patch }).validate());
  }
  const delivery = generateDeliveries(1, { orderIds: [id] })[0];
  await new Delivery(delivery).validate();
  await new Delivery({ ...delivery, driver: id, status: DELIVERY_STATUS.ASSIGNED }).validate();
  await assert.rejects(new Delivery({ ...delivery, driver: id }).validate());
  await assert.rejects(new Delivery({ ...delivery, status: DELIVERY_STATUS.ASSIGNED }).validate());
  assert.ok(Delivery.schema.indexes().some(([keys, options]) => keys.order === 1 && options.unique));
  await new User({ firstName: 'Test', lastName: 'Demo', email: 'driver@example.test', role: USER_ROLES.DRIVER }).validate();
});
