const AppError = require('../errors/AppError');
const dictionary = require('../errors/error-dictionary');
const { logEvent } = require('../utils/log-events');
module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const parserCodes = { 'entity.parse.failed': 'INVALID_JSON', 'entity.too.large': 'PAYLOAD_TOO_LARGE' };
  const parserCode = Object.hasOwn(parserCodes, error.type) ? parserCodes[error.type] : undefined;
  const controlled = error instanceof AppError && Object.hasOwn(dictionary, error.code);
  const code = controlled ? error.code : parserCode || 'INTERNAL_SERVER_ERROR';
  const entry = dictionary[code];
  const message = controlled && entry.status < 500 ? error.message : entry.message;
  logEvent(entry.status >= 500 ? 'error' : 'warning', 'http.error', { code, statusCode: entry.status, method: req.method });
  res.status(entry.status).json({ status: 'error', error: code, message });
};

// Consume partial-response failures here so Express never prints a raw error.
module.exports.closePartial = (_error, req, res, _next) => {
  logEvent('error', 'http.error', { code: 'INTERNAL_SERVER_ERROR', statusCode: 500, method: req.method });
  res.destroy();
};
