const dictionary = require('../errors/error-dictionary');
const { getContext } = require('./request-context');
const levels = Object.freeze({ fatal: 0, error: 1, warning: 2, info: 3, http: 4, debug: 5 });
const messages = Object.freeze({
  'http.access': 'Petición HTTP finalizada',
  'http.error': 'Error HTTP',
  'logger.test': 'Evento de diagnóstico simulado',
  'mocks.started': 'Generación persistente de mocks iniciada',
  'user.document_added': 'Documento de usuario asociado',
  'delivery.proof_added': 'Comprobante de entrega asociado',
  'upload.reconciliation_required': 'Asociación de archivo sin confirmar; requiere reconciliación',
  'order.created': 'Pedido creado',
  'mocks.committed': 'Lote de mocks confirmado',
  'database.connected': 'Conexión a MongoDB establecida',
  'server.started': 'ShipNow / Rina escuchando',
  'server.config_failed': 'Configuración inválida: no se pudo iniciar la aplicación',
  'server.database_failed': 'No se pudo iniciar la aplicación: conexión a MongoDB fallida',
  'server.prepare_failed': 'No se pudo iniciar la aplicación',
  'server.listen_failed': 'No se pudo iniciar la escucha HTTP',
  'server.port_in_use': 'El puerto configurado está ocupado',
  'server.failed': 'Fallo terminal del servidor HTTP',
  'server.cleanup_failed': 'No se pudo completar el cierre de recursos',
  'upload.cleanup_failed': 'No se pudo limpiar un archivo de la petición',
  'catalog.notify_failed': 'Producto guardado; no se pudo notificar la actualización',
  'catalog.load_failed': 'No se pudo cargar el catálogo para el socket',
});
const startupCodes = Object.freeze({
  'server.config_failed': 'STARTUP_CONFIGURATION_ERROR', 'server.database_failed': 'STARTUP_DATABASE_ERROR',
  'server.prepare_failed': 'STARTUP_PREPARATION_ERROR', 'server.listen_failed': 'STARTUP_LISTEN_ERROR',
  'server.port_in_use': 'STARTUP_PORT_IN_USE', 'server.failed': 'SERVER_TERMINAL_ERROR',
});
function safeMetadata(input = {}) {
  const result = {};
  if (Object.hasOwn(messages, input.event)) result.event = input.event;
  if (typeof input.requestId === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.requestId)) result.requestId = input.requestId;
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'].includes(input.method)) result.method = input.method;
  if (Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599) result.statusCode = input.statusCode;
  if (Number.isFinite(input.durationMs) && input.durationMs >= 0) result.durationMs = input.durationMs;
  if (Number.isInteger(input.port) && input.port > 0 && input.port <= 65535) result.port = input.port;
  if (['development', 'test', 'production'].includes(input.nodeEnv)) result.nodeEnv = input.nodeEnv;
  if (['seedUsers', 'generateData'].includes(input.operation)) result.operation = input.operation;
  if (Object.hasOwn(dictionary, input.code) || Object.values(startupCodes).includes(input.code)) result.code = input.code;
  for (const key of ['users', 'drivers', 'orders', 'deliveries']) {
    if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 100) result[key] = input[key];
  }
  for (const key of ['synthetic', 'aborted']) if (typeof input[key] === 'boolean') result[key] = input[key];
  return result;
}
function eventMessage(meta) {
  return meta.event === 'http.error' && Object.hasOwn(dictionary, meta.code) ? dictionary[meta.code].message : messages[meta.event] || 'Evento de aplicación';
}
// No mutable global logger: HTTP context or an explicitly injected instance owns it.
function logEvent(level, event, metadata = {}, logger) {
  const context = getContext();
  const target = logger || context?.logger;
  if (!target || !Object.hasOwn(levels, level)) return;
  const meta = safeMetadata({ ...metadata, event, requestId: context?.requestId || metadata.requestId });
  try { target.log(level, eventMessage(meta), meta); } catch { /* Observability must not change HTTP/business outcomes. */ }
}
module.exports = { levels, messages, startupCodes, safeMetadata, eventMessage, logEvent };
