const Delivery = require('../models/Delivery');
const { normalize, persist } = require('./persistence');

const PUBLIC_FIELDS = 'order driver status createdAt updatedAt';
class DeliveriesRepository {
  create(data, session) { return Delivery.create([data], { session }).then(rows => normalize(rows[0])); }
  state(id, session) { return Delivery.findById(id).select(PUBLIC_FIELDS).session(session || null).lean(); }
  byOrder(order, session) { return Delivery.findOne({ order }).select(PUBLIC_FIELDS).session(session || null).lean(); }
  byDriver(driver, session) { return Delivery.exists({ driver }).session(session || null); }
  assign(id, driver, session) { return Delivery.findOneAndUpdate({ _id: id, status: 'pending', driver: null }, { $set: { driver, status: 'assigned' } }, { returnDocument: 'after', runValidators: true, session }).select(PUBLIC_FIELDS).lean().then(normalize); }
  get(id) { return persist(async () => normalize(await Delivery.findById(id).select(PUBLIC_FIELDS).lean())); }
  list({ page, limit, status }) {
    return persist(async () => {
      const filter = status === undefined ? {} : { status };
      const [rows, count] = await Promise.all([
        Delivery.find(filter).select(PUBLIC_FIELDS).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Delivery.countDocuments(filter),
      ]);
      const totalPages = Math.max(1, Math.ceil(count / limit));
      return { docs: rows.map(normalize), page, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages, prevPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null };
    });
  }

  addProof(id, metadata) { return persist(() => Delivery.findByIdAndUpdate(id, { $push: { proofs: metadata } }, { returnDocument: 'after', runValidators: true, upsert: false }).select('_id').lean()); }
  hasProof(id, filename) { return persist(async () => Boolean(await Delivery.exists({ _id: id, 'proofs.filename': filename }))); }
  initialize() { return persist(() => Delivery.init()); }

  async insertMany(data, session) {
    const documents = await Delivery.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
}

module.exports = DeliveriesRepository;
