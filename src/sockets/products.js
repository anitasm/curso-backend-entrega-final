const { logEvent } = require('../utils/log-events');
function registerProductSocket(io, productsService, logger) {
  io.on('connection', async socket => {
    try { socket.emit('productsUpdated', await productsService.getProducts({ paginate: false, sort: 'desc' })); }
    catch { logEvent('warning', 'catalog.load_failed', {}, logger); socket.emit('errorMessage', 'No se pudo cargar la lista de productos'); }
  });
}
async function notifyProducts(io, productsService, logger) {
  if (!io) return;
  try { io.emit('productsUpdated', await productsService.getProducts({ paginate: false, sort: 'desc' })); }
  catch {
    // A notification failure does not undo an already completed write.
    logEvent('warning', 'catalog.notify_failed', {}, logger);
    try { io.emit('errorMessage', 'Catálogo actualizado; recargá la vista para ver los cambios'); } catch { /* disconnected transport */ }
  }
}
module.exports = { registerProductSocket, notifyProducts };
