const AppError = require('../errors/AppError');
const dictionary = require('../errors/error-dictionary');
module.exports = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const parserCodes = { 'entity.parse.failed': 'INVALID_JSON', 'entity.too.large': 'PAYLOAD_TOO_LARGE' };
  const parserCode = Object.hasOwn(parserCodes, error.type) ? parserCodes[error.type] : undefined;
  const controlled = error instanceof AppError && Object.hasOwn(dictionary, error.code);
  const code = controlled ? error.code : parserCode || 'INTERNAL_SERVER_ERROR';
  const entry = dictionary[code];
  const message = controlled && entry.status < 500 ? error.message : entry.message;
  res.status(entry.status).json({ status: 'error', error: code, message });
};
