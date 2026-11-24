// Opt-in only: node --test test/integration/mocks-transaction.js
// This file is outside the default npm test glob and requires real MongoDB.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectDB, disconnectDB } = require('../../src/config/db');
const createMockPersistence = require('../../src/repositories/mock-transaction');

test('MongoDB real: revierte todo el lote ante un fallo posterior a la última inserción', { timeout: 60000 }, async () => {
  const mongoUri = process.env.TEST_MONGODB_URI;
  assert.ok(mongoUri, 'Requiere TEST_MONGODB_URI explícita; nunca utiliza .env');
  assert.equal(new URL(mongoUri).pathname, '/shipnow_test');
  try {
    await connectDB(mongoUri);
    const infrastructure = createMockPersistence(undefined, { nodeEnv: 'test' });
    // Verify the active database before loading models or initializing collections.
    infrastructure.assertMockDatabase();
    const UsersRepository = require('../../src/repositories/users.repository');
    const OrdersRepository = require('../../src/repositories/orders.repository');
    const DeliveriesRepository = require('../../src/repositories/deliveries.repository');
    const MocksService = require('../../src/services/mocks.service');
    const usersRepository = new UsersRepository();
    const ordersRepository = new OrdersRepository();
    const deliveriesRepository = new DeliveriesRepository();
    await Promise.all([usersRepository.initialize(), ordersRepository.initialize(), deliveriesRepository.initialize()]);
    const ids = { users: [], orders: [], deliveries: [] };
    const capture = (repository, collection, fail = false) => ({
      async insertMany(data, session) {
        const rows = await repository.insertMany(data, session);
        ids[collection].push(...rows.map(row => row.id));
        if (fail) throw new Error('Fallo deliberado para comprobar rollback');
        return rows;
      },
    });
    const service = new MocksService({
      ...infrastructure,
      usersRepository: capture(usersRepository, 'users'),
      ordersRepository: capture(ordersRepository, 'orders'),
      deliveriesRepository: capture(deliveriesRepository, 'deliveries', true),
    });
    await assert.rejects(service.generateData({ users: 1, drivers: 1, orders: 1, deliveries: 1 }), { status: 500 });
    assert.ok(ids.users.length >= 2 && ids.orders.length >= 1 && ids.deliveries.length >= 1, 'La prueba debe alcanzar todas las inserciones antes del fallo');
    const User = require('../../src/models/User');
    const Order = require('../../src/models/Order');
    const Delivery = require('../../src/models/Delivery');
    for (const [Model, createdIds] of [[User, ids.users], [Order, ids.orders], [Delivery, ids.deliveries]]) {
      assert.equal(await Model.countDocuments({ _id: { $in: createdIds } }), 0, 'No deben quedar documentos de la transacción fallida');
    }
  } finally {
    await disconnectDB();
  }
});
