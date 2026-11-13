const mongoose = require('mongoose');
const AppError = require('../errors/AppError');
const { persist } = require('./persistence');
const { MOCK_DATABASE_NAME } = require('../config/mocks.config');

function createMockPersistence(connection = mongoose.connection) {
  function assertMockDatabase() {
    if (connection.readyState !== 1 || connection.db?.databaseName !== MOCK_DATABASE_NAME) {
      throw new AppError(403, `Los mocks solo pueden escribirse en la base ${MOCK_DATABASE_NAME}`);
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
          throw new AppError(503, 'Los mocks requieren transacciones de MongoDB: usá Atlas o un replica set; no se admite un servidor standalone');
        }
        throw error;
      }
    });
  }

  return { assertMockDatabase, withTransaction };
}

module.exports = createMockPersistence;
