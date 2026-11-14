const { test } = require('node:test');
const assert = require('node:assert/strict');
const mockFixtures = require('./helpers/mocks-fixtures');
const { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, DELIVERY_PRIORITY } = require('../src/constants');

test('Mocks preview: cantidades, roles, emails únicos y ninguna persistencia', () => {
  const f = mockFixtures();
  const users = f.service.previewUsers({ qty: '2' });
  assert.equal(users.length, 2);
  assert.deepEqual(users.map(user => user.role), [USER_ROLES.USER, USER_ROLES.DRIVER]);
  assert.ok(users.every(user => user.firstName && user.lastName && user.email.endsWith('@example.test')));
  assert.equal(f.service.previewUsers().length, 10);
  assert.equal(f.service.previewUsers({ qty: '100' }).length, 100);
  assert.ok(f.service.previewUsers({ qty: '2' }, USER_ROLES.DRIVER).every(user => user.role === USER_ROLES.DRIVER));
  const emails = [...users, ...f.service.previewUsers({ qty: '2' })].map(user => user.email);
  assert.equal(new Set(emails).size, emails.length);
  assert.deepEqual(f.calls, []);
});

test('Mocks preview: pedidos y entregas válidos con referencias simuladas', () => {
  const f = mockFixtures();
  const orders = f.service.previewOrders({ qty: '2' });
  for (const order of orders) {
    assert.match(order.customer, /^[a-f0-9]{24}$/);
    assert.ok(order.items.length);
    assert.equal(order.total, order.items.reduce((sum, item) => sum + item.quantity * item.price, 0));
    assert.ok(Object.values(ORDER_STATUS).includes(order.status));
    assert.ok(Object.values(DELIVERY_PRIORITY).includes(order.priority));
  }
  const deliveries = f.service.previewDeliveries({ qty: '2' });
  assert.equal(new Set(deliveries.map(delivery => delivery.order)).size, 2);
  for (const delivery of deliveries) {
    assert.match(delivery.order, /^[a-f0-9]{24}$/);
    assert.equal(delivery.status, DELIVERY_STATUS.PENDING);
    assert.equal(delivery.driver, undefined);
  }
  assert.deepEqual(f.calls, []);
});

test('Mocks: qty inválido y query desconocido se rechazan sin tocar repositorios', async () => {
  const invalid = ['', ' ', '0', '-1', '101', '1.0', '2e1', '2abc', 'NaN', true, null, ['1', '2'], {}];
  for (const qty of invalid) {
    const f = mockFixtures();
    for (const method of ['previewUsers', 'previewOrders', 'previewDeliveries']) assert.throws(() => f.service[method]({ qty }), { status: 400 });
    await assert.rejects(f.service.seed({ qty }), { status: 400 });
    assert.deepEqual(f.calls, []);
  }
  const f = mockFixtures();
  assert.throws(() => f.service.previewUsers({ other: '1' }), { status: 400 });
  await assert.rejects(f.service.seed(), { status: 400 });
  await assert.rejects(f.service.seed({ qty: '2', other: '1' }), { status: 400 });
  assert.deepEqual(f.calls, []);
});

test('Mocks seed: mezcla de perfiles y conteos reales tras confirmar la transacción', async () => {
  const f = mockFixtures();
  assert.equal(await f.service.seed({ qty: '10' }), 10);
  assert.deepEqual(f.calls, ['guard', 'begin', 'users', 'commit']);
  assert.equal(f.batches[0].rows.filter(user => user.role === USER_ROLES.USER).length, 5);
  assert.equal(f.batches[0].rows.filter(user => user.role === USER_ROLES.DRIVER).length, 5);
  assert.equal(f.committed(), true);
  await f.service.seed({ qty: '10' });
  const emails = f.batches.flatMap(batch => batch.rows.map(user => user.email));
  assert.equal(new Set(emails).size, 20);
});

test('Mocks generateData: orden, sesión compartida, IDs persistidos, roles y estados', async () => {
  const f = mockFixtures();
  const result = await f.service.generateData({ users: 2, drivers: 1, orders: 2, deliveries: 2 });
  assert.deepEqual(result, { users: 2, drivers: 1, orders: 2, deliveries: 2 });
  assert.deepEqual(f.calls, ['guard', 'begin', 'users', 'users', 'orders', 'deliveries', 'commit']);
  const [customers, drivers, orders, deliveries] = f.batches.map(batch => batch.rows);
  assert.ok(customers.every(user => user.role === USER_ROLES.USER));
  assert.ok(drivers.every(user => user.role === USER_ROLES.DRIVER));
  assert.ok(orders.every(order => customers.some(user => user.id === order.customer)));
  assert.ok(deliveries.every(delivery => orders.some(order => order.id === delivery.order)));
  assert.ok(deliveries.every(delivery => drivers.some(user => user.id === delivery.driver)));
  assert.ok(orders.every(order => order.status === ORDER_STATUS.ASSIGNED));
  assert.ok(deliveries.every(delivery => delivery.status === DELIVERY_STATUS.ASSIGNED));
  assert.equal(new Set(deliveries.map(delivery => delivery.order)).size, 2);
});

test('Mocks generateData: sin repartidor, cero omitidos y asignación parcial coherente', async () => {
  const f = mockFixtures();
  assert.deepEqual(await f.service.generateData({ users: 1, orders: 2, deliveries: 1 }), { users: 1, drivers: 0, orders: 2, deliveries: 1 });
  assert.deepEqual(f.calls, ['guard', 'begin', 'users', 'orders', 'deliveries', 'commit']);
  assert.equal(f.batches[2].rows[0].driver, undefined);
  assert.equal(f.batches[2].rows[0].status, DELIVERY_STATUS.PENDING);
  assert.ok(f.batches[1].rows.every(order => order.status === ORDER_STATUS.CREATED));
  const partial = mockFixtures();
  await partial.service.generateData({ users: 1, drivers: 1, orders: 2, deliveries: 1 });
  assert.deepEqual(partial.batches[2].rows.map(order => order.status), [ORDER_STATUS.ASSIGNED, ORDER_STATUS.CREATED]);
  const onlyDrivers = mockFixtures();
  assert.deepEqual(await onlyDrivers.service.generateData({ drivers: 100 }), { users: 0, drivers: 100, orders: 0, deliveries: 0 });
  assert.equal(onlyDrivers.batches.length, 1);
});

test('Mocks generateData: tipos, límites y dependencias inválidas antes de persistir', async () => {
  const invalid = [undefined, null, [], {}, { users: 0 }, { users: '2' }, { users: true }, { users: null }, { users: 1.5 }, { users: -1 }, { users: NaN }, { users: Infinity }, { users: 101 }, { users: 100, drivers: 1 }, { users: 1, unknown: 2 }, { orders: 1 }, { drivers: 1, orders: 1 }, { users: 1, orders: 1, deliveries: 2 }];
  for (const input of invalid) {
    const f = mockFixtures();
    await assert.rejects(f.service.generateData(input), { status: 400 });
    assert.deepEqual(f.calls, []);
  }
  const f = mockFixtures();
  await assert.rejects(f.service.generateData({ users: 1 }, { qty: '2' }), { status: 400 });
  assert.deepEqual(f.calls, []);
});

test('Mocks: base no habilitada bloquea ambos POST antes de la transacción', async () => {
  const f = mockFixtures({ forbidden: true });
  await assert.rejects(f.service.seed({ qty: '2' }), { status: 403 });
  await assert.rejects(f.service.generateData({ users: 1 }), { status: 403 });
  assert.deepEqual(f.calls, ['guard', 'guard']);
});

test('Mocks: fallo de última escritura se propaga sin conteo ni commit de éxito', async () => {
  const f = mockFixtures({ failDeliveries: true });
  await assert.rejects(f.service.generateData({ users: 1, orders: 1, deliveries: 1 }), error => error.code === 'MOCK_GENERATION_ERROR' && /Fallo simulado/.test(error.cause.message));
  assert.deepEqual(f.calls, ['guard', 'begin', 'users', 'orders', 'deliveries', 'abort']);
  assert.equal(f.committed(), false);
});
