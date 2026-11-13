const { randomBytes } = require('node:crypto');
const { USER_ROLES } = require('../constants');
const v = require('../utils/validation');
const generateUsers = require('../mocks/users.generator');
const generateOrders = require('../mocks/orders.generator');
const generateDeliveries = require('../mocks/deliveries.generator');

function quantity(query, required = false) {
  v.fields(query, ['qty']);
  if (query.qty === undefined && !required) return 10;
  if (typeof query.qty !== 'string' || !/^\d+$/.test(query.qty)) v.invalid('qty debe ser un entero decimal entre 1 y 100');
  const value = Number(query.qty);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) v.invalid('qty debe estar entre 1 y 100');
  return value;
}

function batchCounts(input) {
  const keys = ['users', 'drivers', 'orders', 'deliveries'];
  v.fields(input, keys);
  const counts = {};
  for (const key of keys) {
    const value = Object.hasOwn(input, key) ? input[key] : 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) v.invalid(`${key} debe ser un entero numérico entre 0 y 100`);
    counts[key] = value;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > 100) v.invalid('El lote debe contener entre 1 y 100 registros en total');
  if (counts.orders && !counts.users) v.invalid('Para generar pedidos se requiere al menos un cliente (users)');
  if (counts.deliveries > counts.orders) v.invalid('deliveries no puede superar orders');
  return counts;
}

class MocksService {
  constructor({ usersRepository, ordersRepository, deliveriesRepository, assertMockDatabase, withTransaction }) {
    Object.assign(this, { usersRepository, ordersRepository, deliveriesRepository, assertMockDatabase, withTransaction });
  }

  previewUsers(query = {}, role) { return generateUsers(quantity(query), role); }

  previewOrders(query = {}) {
    return generateOrders(quantity(query), { customerIds: [randomBytes(12).toString('hex')] });
  }

  previewDeliveries(query = {}) {
    const count = quantity(query);
    const orderIds = Array.from({ length: count }, () => randomBytes(12).toString('hex'));
    return generateDeliveries(count, { orderIds });
  }

  async seed(query = {}) {
    const count = quantity(query, true);
    await this.assertMockDatabase();
    return this.withTransaction(async session => {
      const users = await this.usersRepository.insertMany(generateUsers(count), session);
      return users.length;
    });
  }

  async generateData(input, query = {}) {
    v.fields(query, []);
    const counts = batchCounts(input);
    await this.assertMockDatabase();
    return this.withTransaction(async session => {
      // All arrays are local to this attempt: a driver retry rebuilds the full batch.
      const users = counts.users ? await this.usersRepository.insertMany(generateUsers(counts.users, USER_ROLES.USER), session) : [];
      const drivers = counts.drivers ? await this.usersRepository.insertMany(generateUsers(counts.drivers, USER_ROLES.DRIVER), session) : [];
      const orders = counts.orders ? await this.ordersRepository.insertMany(generateOrders(counts.orders, {
        customerIds: users.map(user => user.id),
        assignedCount: drivers.length ? counts.deliveries : 0,
      }), session) : [];
      const deliveries = counts.deliveries ? await this.deliveriesRepository.insertMany(generateDeliveries(counts.deliveries, {
        orderIds: orders.map(order => order.id),
        driverIds: drivers.map(driver => driver.id),
      }), session) : [];
      return { users: users.length, drivers: drivers.length, orders: orders.length, deliveries: deliveries.length };
    });
  }
}

module.exports = MocksService;
