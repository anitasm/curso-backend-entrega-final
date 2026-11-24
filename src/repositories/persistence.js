const AppError = require('../errors/AppError');
const normalize = document => {
  if (!document) return null;
  const source = typeof document.toObject === 'function' ? document.toObject() : document;
  const {
    documents,
    proofs,
    history,
    historyComplete,
    revision,
    referenceRevision,
    deletedAt,
    ...publicFields
  } = source;
  return { ...publicFields, _id: String(source._id), id: String(source._id) };
};
async function persist(operation, { entity, fallback = 'DATABASE_ERROR' } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
      throw new AppError(
        entity === 'users' && field === 'email'
          ? 'USER_ALREADY_EXISTS'
          : entity === 'products' && field === 'code'
            ? 'DUPLICATE_CODE'
            : entity === 'deliveries' && field === 'order'
              ? 'DELIVERY_ALREADY_EXISTS'
              : 'DUPLICATE_KEY',
        { cause: error }
      );
    }
    if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name))
      throw new AppError('VALIDATION_ERROR', { cause: error });
    throw new AppError(fallback, { cause: error });
  }
}
module.exports = { normalize, persist };
