const { CATALOG_SNAPSHOT_LIMIT } = require('../config/performance.config');
const { logEvent } = require('../utils/log-events');
function registerProductSocket(io, productsService, logger) {
  const pending = new Set();
  const connected = socket => {
    const task = load(socket);
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  async function load(socket) {
    try { socket.emit('productsUpdated', await productsService.getProducts({ paginate: false, sort: 'desc', limit: CATALOG_SNAPSHOT_LIMIT })); }
    catch { logEvent('warning', 'catalog.load_failed', {}, logger); socket.emit('errorMessage', 'No se pudo cargar la lista de productos'); }
  }
  io.on('connection', connected);
  return async () => {
    io.removeListener?.('connection', connected);
    await Promise.allSettled([...pending]);
  };
}
async function notifyProducts(io, productsService, logger) {
  if (!io) return;
  try { io.emit('productsUpdated', await productsService.getProducts({ paginate: false, sort: 'desc', limit: CATALOG_SNAPSHOT_LIMIT })); }
  catch {
    // A notification failure does not undo an already completed write.
    logEvent('warning', 'catalog.notify_failed', {}, logger);
    try { io.emit('errorMessage', 'Catálogo actualizado; recargá la vista para ver los cambios'); } catch { /* disconnected transport */ }
  }
}
module.exports = { registerProductSocket, notifyProducts };
