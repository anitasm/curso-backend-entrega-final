const mongoose = require('mongoose');
const AppError = require('../errors/AppError');
const { persist } = require('./persistence');
const { MOCK_DATABASE_NAME } = require('../config/mocks.config');

function createMockPersistence(connection = mongoose.connection, { nodeEnv = 'development' } = {}) {
  function assertMockDatabase() {
    if (connection.readyState !== 1 || connection.db?.databaseName !== (nodeEnv === 'test' ? 'shipnow_test' : MOCK_DATABASE_NAME) || !['development', 'test'].includes(nodeEnv)) {
      throw new AppError('MOCK_DATABASE_FORBIDDEN');
    }
  }

  async function withTransaction(work) {
    assertMockDatabase();
    // Mongoose delegates to the driver's withTransaction, including its retries.
    // Never translate errors inside work: the driver needs their original labels.
    return persist(async () => {
      try {
        return await connection.transaction(async session => {
          assertMockDatabase();
          return work(session);
        });
      } catch (error) {
        if (error.code === 20 && /Transaction numbers|replica set|mongos/i.test(error.message)) {
          throw new AppError('MOCK_TRANSACTIONS_REQUIRED', { cause: error });
        }
        throw error;
      }
    }, { entity: 'users', fallback: 'MOCK_GENERATION_ERROR' });
  }

  return { assertMockDatabase, withTransaction };
}

module.exports = createMockPersistence;
