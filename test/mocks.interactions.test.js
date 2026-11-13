const { test } = require('node:test');
const assert = require('node:assert/strict');
const MocksService = require('../src/services/mocks.service');
const AppError = require('../src/errors/AppError');
const { USER_ROLES, MOCKING_PARAMETERS } = require('../src/constants');

test('Mock de interacción: una escritura con sesión y resultado después del commit', async t => {
  // Arrange: fixture conocida y stub transaccional; mock.fn registra la interacción.
  const session = { fixtureSession: true };
  const fixture = { id: '1234567890abcdef12345678', firstName: 'Sol', lastName: 'Ejemplo', email: 'sol@example.test', role: USER_ROLES.USER };
  const events = [];
  const insertMany = t.mock.fn(async () => { events.push('insert'); return [fixture]; });
  const guard = t.mock.fn(() => {});
  const transaction = t.mock.fn(async work => {
    events.push('begin');
    const result = await work(session);
    events.push('commit');
    return result;
  });
  const service = new MocksService({ usersRepository: { insertMany }, assertMockDatabase: guard, withTransaction: transaction });

  // Act
  const result = await service.seedUsers({ qty: '1' });
  events.push('response');

  // Assert: los datos salen del repositorio, no del generador previo a persistir.
  assert.deepEqual(result, [fixture]);
  assert.equal(guard.mock.callCount(), 1);
  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(insertMany.mock.callCount(), 1);
  const [profiles, receivedSession] = insertMany.mock.calls[0].arguments;
  assert.equal(receivedSession, session);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].role, USER_ROLES.USER);
  assert.match(profiles[0].email, /@example\.test$/);
  assert.deepEqual(events, ['begin', 'insert', 'commit', 'response']);
});

test('Stub de rechazo: error original sin éxito ni reintento del servicio', async t => {
  const failure = new AppError(409, 'Conflicto de prueba');
  const insertMany = t.mock.fn(async () => { throw failure; });
  const transaction = t.mock.fn(work => work({ fixtureSession: true }));
  const service = new MocksService({ usersRepository: { insertMany }, assertMockDatabase: () => {}, withTransaction: transaction });
  await assert.rejects(service.seedUsers({ qty: '1' }), error => error === failure);
  assert.equal(insertMany.mock.callCount(), 1);
  assert.equal(transaction.mock.callCount(), 1);
});

test('Clase 2: parámetros de mocking centralizados y sin contraseña predeterminada', () => {
  assert.ok(Object.isFrozen(MOCKING_PARAMETERS));
  assert.deepEqual(MOCKING_PARAMETERS, { DEFAULT: 10, MAX: 100 });
});
