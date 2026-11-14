const Order = require('../models/Order');
const { normalize, persist } = require('./persistence');

const PUBLIC_FIELDS = 'customer items deliveryAddress total status priority createdAt updatedAt';
class OrdersRepository {
  create(data) { return persist(async () => normalize(await Order.create(data))); }
  get(id) { return persist(async () => normalize(await Order.findById(id).select(PUBLIC_FIELDS).lean())); }
  list({ page, limit, status }) {
    return persist(async () => {
      const filter = status === undefined ? {} : { status };
      const [rows, count] = await Promise.all([
        Order.find(filter).select(PUBLIC_FIELDS).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Order.countDocuments(filter),
      ]);
      const totalPages = Math.max(1, Math.ceil(count / limit));
      return { docs: rows.map(normalize), page, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages, prevPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null };
    });
  }

  initialize() { return persist(() => Order.init()); }

  async insertMany(data, session) {
    // Keep original driver errors/labels inside the transaction callback.
    const documents = await Order.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
}

module.exports = OrdersRepository;
