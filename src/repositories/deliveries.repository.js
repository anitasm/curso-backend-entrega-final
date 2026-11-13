const Delivery = require('../models/Delivery');
const { normalize, persist } = require('./persistence');

class DeliveriesRepository {
  initialize() { return persist(() => Delivery.init()); }

  async insertMany(data, session) {
    const documents = await Delivery.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
}

module.exports = DeliveriesRepository;
