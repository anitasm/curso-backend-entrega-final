const mongoose = require('mongoose');
const AppError = require('../errors/AppError');
const { persist } = require('./persistence');
module.exports =
  (connection = mongoose.connection) =>
  work =>
    persist(
      async () => {
        try {
          return await connection.transaction(session => work(session));
        } catch (error) {
          if (error.code === 20) throw new AppError('TRANSACTIONS_REQUIRED');
          throw error;
        }
      },
      { entity: 'deliveries' }
    );
