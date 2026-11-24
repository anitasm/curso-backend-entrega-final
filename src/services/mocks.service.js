const { randomBytes } = require('node:crypto');
const { USER_ROLES, MOCKING_PARAMETERS } = require('../constants');
const v = require('../utils/validation');
const { logEvent } = require('../utils/log-events');
const { persist } = require('../repositories/persistence');
const generateUsers = require('../mocks/users.generator');
const generateOrders = require('../mocks/orders.generator');
const generateDeliveries = require('../mocks/deliveries.generator');

function quantity(query, required = false) {
  v.fields(query, ['qty'], 'INVALID_MOCK_DATA');
  if (query.qty === undefined && !required) return MOCKING_PARAMETERS.DEFAULT;
  if (typeof query.qty !== 'string' || !/^\d+$/.test(query.qty))
    v.invalid(
      `qty debe ser un entero decimal entre 1 y ${MOCKING_PARAMETERS.MAX}`,
      'INVALID_MOCK_AMOUNT'
    );
  const value = Number(query.qty);
  if (!Number.isSafeInteger(value) || value < 1 || value > MOCKING_PARAMETERS.MAX)
    v.invalid(`qty debe estar entre 1 y ${MOCKING_PARAMETERS.MAX}`, 'INVALID_MOCK_AMOUNT');
  return value;
}

function batchCounts(input) {
  const keys = ['users', 'drivers', 'orders', 'deliveries'];
  v.fields(input, keys, 'INVALID_MOCK_DATA');
  const counts = {};
  for (const key of keys) {
    const value = Object.hasOwn(input, key) ? input[key] : 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > MOCKING_PARAMETERS.MAX)
      v.invalid(
        `${key} debe ser un entero numérico entre 0 y ${MOCKING_PARAMETERS.MAX}`,
        'INVALID_MOCK_AMOUNT'
      );
    counts[key] = value;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > MOCKING_PARAMETERS.MAX)
    v.invalid(
      `El lote debe contener entre 1 y ${MOCKING_PARAMETERS.MAX} registros en total`,
      'INVALID_MOCK_AMOUNT'
    );
  if (counts.orders && !counts.users)
    v.invalid('Para generar pedidos se requiere al menos un cliente (users)', 'INVALID_MOCK_DATA');
  if (counts.deliveries > counts.orders)
    v.invalid('deliveries no puede superar orders', 'INVALID_MOCK_DATA');
  return counts;
}

class MocksService {
  constructor({
    usersRepository,
    ordersRepository,
    deliveriesRepository,
    assertMockDatabase,
    withTransaction,
    logger,
  }) {
    Object.assign(this, {
      usersRepository,
      ordersRepository,
      deliveriesRepository,
      assertMockDatabase,
      withTransaction,
      logger,
    });
  }

  runTransaction(work) {
    return persist(() => this.withTransaction(work), {
      entity: 'users',
      fallback: 'MOCK_GENERATION_ERROR',
    });
  }

  previewUsers(query = {}, role) {
    return generateUsers(quantity(query), role);
  }

  previewOrders(query = {}) {
    return generateOrders(quantity(query), { customerIds: [randomBytes(12).toString('hex')] });
  }

  previewDeliveries(query = {}) {
    const count = quantity(query);
    const orderIds = Array.from({ length: count }, () => randomBytes(12).toString('hex'));
    return generateDeliveries(count, { orderIds });
  }

  async seedUsers(query = {}, { requireQuantity = false } = {}) {
    const count = quantity(query, requireQuantity);
    await this.assertMockDatabase();
    logEvent(
      'debug',
      'mocks.started',
      { operation: 'seedUsers', users: Math.ceil(count / 2), drivers: Math.floor(count / 2) },
      this.logger
    );
    const users = await this.runTransaction(session =>
      this.usersRepository.insertMany(generateUsers(count), session)
    );
    logEvent(
      'info',
      'mocks.committed',
      {
        operation: 'seedUsers',
        users: users.filter(u => u.role === USER_ROLES.USER).length,
        drivers: users.filter(u => u.role === USER_ROLES.DRIVER).length,
      },
      this.logger
    );
    return users;
  }

  async seed(query = {}) {
    const users = await this.seedUsers(query, { requireQuantity: true });
    return users.length;
  }

  async generateData(input, query = {}) {
    v.fields(query, [], 'INVALID_MOCK_DATA');
    const counts = batchCounts(input);
    await this.assertMockDatabase();
    logEvent('debug', 'mocks.started', { operation: 'generateData', ...counts }, this.logger);
    const result = await this.runTransaction(async session => {
      // All arrays are local to this attempt: a driver retry rebuilds the full batch.
      const users = counts.users
        ? await this.usersRepository.insertMany(
            generateUsers(counts.users, USER_ROLES.USER),
            session
          )
        : [];
      const drivers = counts.drivers
        ? await this.usersRepository.insertMany(
            generateUsers(counts.drivers, USER_ROLES.DRIVER),
            session
          )
        : [];
      const orders = counts.orders
        ? await this.ordersRepository.insertMany(
            generateOrders(counts.orders, {
              customerIds: users.map(user => user.id),
              assignedCount: drivers.length ? counts.deliveries : 0,
            }),
            session
          )
        : [];
      const deliveries = counts.deliveries
        ? await this.deliveriesRepository.insertMany(
            generateDeliveries(counts.deliveries, {
              orderIds: orders.map(order => order.id),
              driverIds: drivers.map(driver => driver.id),
            }),
            session
          )
        : [];
      return {
        users: users.length,
        drivers: drivers.length,
        orders: orders.length,
        deliveries: deliveries.length,
      };
    });
    logEvent('info', 'mocks.committed', { operation: 'generateData', ...result }, this.logger);
    return result;
  }
}

module.exports = MocksService;
