const Order = require('../models/Order');
const { normalize, persist } = require('./persistence');

class OrdersRepository {
  initialize() { return persist(() => Order.init()); }

  async insertMany(data, session) {
    // Keep original driver errors/labels inside the transaction callback.
    const documents = await Order.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
}

module.exports = OrdersRepository;
