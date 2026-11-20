// Isolated container smoke fixture: real entrypoint/HTTP/logging with in-memory data.
// Never reads a real MongoDB URI or connects to a database.
const { fixtures } = require('./fixtures');
const f = fixtures();
const db = require('../../src/config/db');
db.connectDB = async () => {};
db.disconnectDB = async () => {};
for (const name of ['products', 'users', 'orders', 'deliveries']) {
  const Repository = require('../../src/repositories/' + name + '.repository');
  Repository.prototype.initialize = async () => {};
  if (f[name + 'Repository']) Object.assign(Repository.prototype, f[name + 'Repository']);
  else Repository.prototype.list = async ({ page }) => ({ docs: [], page, totalPages: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
}
process.env.MONGODB_URI = 'mongodb://synthetic.invalid/test';
void require('../../src/server').startServer();
