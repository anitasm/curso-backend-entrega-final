const MocksService = require('../../src/services/mocks.service');
const AppError = require('../../src/errors/AppError');
function mockFixtures({ forbidden = false, failDeliveries = false } = {}) {
  const calls = [];
  const batches = [];
  const session = { testSession: true };
  let sequence = 1000;
  let committed = false;
  const repository = name => ({
    async insertMany(data, receivedSession) {
      calls.push(name);
      if (receivedSession !== session) throw new Error('Sesión incorrecta');
      if (!data.length) throw new Error('No se permiten escrituras vacías');
      if (name === 'deliveries' && failDeliveries) throw new Error('Fallo simulado en última escritura');
      const rows = data.map(row => {
        const id = (sequence++).toString(16).padStart(24, '0');
        return { ...row, _id: id, id };
      });
      batches.push({ name, rows });
      return rows;
    },
  });
  const dependencies = {
    usersRepository: repository('users'),
    ordersRepository: repository('orders'),
    deliveriesRepository: repository('deliveries'),
    assertMockDatabase: () => {
      calls.push('guard');
      if (forbidden) throw new AppError(403, 'Base no habilitada para mocks');
    },
    withTransaction: async work => {
      calls.push('begin');
      try {
        const result = await work(session);
        committed = true;
        calls.push('commit');
        return result;
      } catch (error) {
        calls.push('abort');
        throw error;
      }
    },
  };
  return { service: new MocksService(dependencies), dependencies, calls, batches, committed: () => committed };
}
module.exports = mockFixtures;
