// Isolated lifecycle probes; no connection to MongoDB or application data.
const http = require('node:http');
const { createLogger } = require('../../src/utils/logger');
const db = require('../../src/config/db');
const mode = process.argv[2], logDir = process.argv[3];
const secret = 'mongodb://private:secret@example.test/private';
let disconnects = 0;
db.connectDB = async () => { if (mode === 'connection') throw new Error(secret); };
db.disconnectDB = async () => { disconnects++; };
for (const name of ['products', 'users', 'orders', 'deliveries']) {
  require(`../../src/repositories/${name}.repository`).prototype.initialize = async () => {
    if (mode === 'prepare') throw new Error(secret);
  };
}
const { startServer } = require('../../src/server');
const loggerFactory = options => createLogger({ ...options, logDir });
(async () => {
  let occupied;
  if (['occupied', 'terminal', 'success'].includes(mode)) {
    occupied = http.createServer();
    await new Promise(resolve => occupied.listen(0, resolve));
    process.env.PORT = String(occupied.address().port);
    if (mode !== 'occupied') await new Promise(resolve => occupied.close(resolve));
  }
  const instance = await startServer({ loggerFactory });
  if (mode === 'terminal') instance.server.emit('error', new Error(secret));
  if (instance) await instance.close();
  if (mode === 'occupied') await new Promise(resolve => occupied.close(resolve));
  if (disconnects !== (mode === 'config' ? 0 : 1)) throw new Error('Cierre de conexión inesperado');
})();
