const User = require('../models/User');
const { normalize, persist: execute } = require('./persistence');
const persist = operation => execute(operation, { entity: 'users' });
const PUBLIC_FIELDS = 'firstName lastName email role createdAt updatedAt';
class UsersRepository {
  addDocument(id, metadata) { return persist(() => User.findByIdAndUpdate(id, { $push: { documents: metadata } }, { returnDocument: 'after', runValidators: true, upsert: false }).select('_id').lean()); }
  hasDocument(id, filename) { return persist(async () => Boolean(await User.exists({ _id: id, 'documents.filename': filename }))); }
  touch(id, session) { return User.findByIdAndUpdate(id, { $inc: { referenceRevision: 1 } }, { returnDocument: 'after', session }).select(PUBLIC_FIELDS).lean().then(normalize); }
  removeInSession(id, session) { return User.findByIdAndDelete(id, { session }).select(PUBLIC_FIELDS).lean().then(normalize); }
  initialize() { return persist(() => User.init()); }
  async insertMany(data, session) {
    // Batch writes belong to a transaction; translate errors only after it ends.
    const documents = await User.insertMany(data, { session, ordered: true });
    return documents.map(normalize);
  }
  list({ page, limit }) {
    return persist(async () => {
      const [rows, count] = await Promise.all([
        User.find().select(PUBLIC_FIELDS).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        User.countDocuments(),
      ]);
      const totalPages = Math.max(1, Math.ceil(count / limit));
      return { docs: rows.map(normalize), page, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages, prevPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null };
    });
  }
  get(id) { return persist(async () => normalize(await User.findById(id).select(PUBLIC_FIELDS).lean())); }
  create(data) { return persist(async () => normalize(await User.create(data))); }
  update(id, data) { return persist(async () => normalize(await User.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after', runValidators: true }).select(PUBLIC_FIELDS).lean())); }
  remove(id) { return persist(async () => normalize(await User.findByIdAndDelete(id).select(PUBLIC_FIELDS).lean())); }
}
module.exports = UsersRepository;
