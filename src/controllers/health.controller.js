// Liveness only: importing or calling this handler does not query MongoDB.
module.exports = (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
