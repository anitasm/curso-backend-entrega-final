const dictionary = require('./error-dictionary');
class AppError extends Error {
  constructor(code, { message, cause } = {}) {
    if (!Object.hasOwn(dictionary, code)) throw new TypeError('Clave de error desconocida');
    const entry = dictionary[code];
    super(entry.status < 500 && message ? message : entry.message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
  }
}
module.exports = AppError;
