const Order = require('../models/Order');
const { normalize, persist } = require('./persistence');

const PUBLIC_FIELDS = 'customer items deliveryAddress total status priority createdAt updatedAt';
class OrdersRepository {
  create(data, session) {
    const payload = {
      ...data,
      history: [{ status: 'created', timestamp: new Date(), source: 'actual' }],
      historyComplete: true,
    };
    const work = async () =>
      normalize(
        session ? (await Order.create([payload], { session }))[0] : await Order.create(payload)
      );
    return session ? work() : persist(work);
  }
  state(id, session) {
    const work = () =>
      Order.findOne({ _id: id, deletedAt: null })
        .select('+revision +history +historyComplete')
        .session(session || null)
        .lean();
    return session ? work() : persist(work);
  }
  byCustomer(id, session) {
    return Order.exists({ customer: id }).session(session || null);
  }
  change(state, data, event, session) {
    const filter = {
      _id: state._id,
      deletedAt: null,
      status: state.status,
      revision: state.revision === undefined ? { $exists: false } : state.revision,
    };
    const update = { $set: data, $inc: { revision: 1 } };
    if (event) {
      update.$push = { history: event };
      update.$set = { ...data, historyComplete: Boolean(state.historyComplete) };
    }
    return Order.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      runValidators: true,
      session,
      upsert: false,
    })
      .select(PUBLIC_FIELDS)
      .lean()
      .then(normalize);
  }
  get(id, session) {
    const work = async () => {
      const query = Order.findOne({ _id: id, deletedAt: null }).select(PUBLIC_FIELDS);
      if (session) query.session(session);
      return normalize(await query.lean());
    };
    return session ? work() : persist(work);
  }
  list({ page, limit, status }) {
    return persist(async () => {
      const filter = status === undefined ? { deletedAt: null } : { deletedAt: null, status };
      const [rows, count] = await Promise.all([
        Order.find(filter)
          .select(PUBLIC_FIELDS)
          .sort({ createdAt: -1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Order.countDocuments(filter),
      ]);
      const totalPages = Math.max(1, Math.ceil(count / limit));
      return {
        docs: rows.map(normalize),
        page,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
      };
    });
  }

  initialize() {
    return persist(() => Order.init());
  }

  async insertMany(data, session) {
    // Keep original driver errors/labels inside the transaction callback.
    const documents = await Order.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
}

module.exports = OrdersRepository;
