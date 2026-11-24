const path = require('node:path');
const fs = require('node:fs');
const { levels, safeMetadata, eventMessage } = require('./log-events');
const DEFAULT_LOG_DIR = path.resolve(__dirname, '../../logs');
const OPERATIONAL_WARNING = 'warning: No hay destinos de logs disponibles.\n';
function createLogger({ nodeEnv = 'development', logLevel, logDir = DEFAULT_LOG_DIR, file = true,
  consoleTransport, transports, maxSize = 10 * 1024 * 1024, report = text => process.stderr.write(text), fileFactory } = {}) {
  const winston = require('winston');
  const selected = [], failed = new Set();
  let warned = false;
  const threshold = logLevel ?? (nodeEnv === 'production' ? 'info' : 'debug');
  const json = () => winston.format.combine(winston.format.timestamp(), winston.format.json());
  // Explicit transports are for isolated tests; Console is forbidden outside development.
  if (transports) selected.push(...transports.filter(t => nodeEnv === 'development' || !(t instanceof winston.transports.Console)));
  else {
    if (nodeEnv === 'development') {
      const output = consoleTransport || new winston.transports.Console({ stderrLevels: ['fatal'] });
      output.level = threshold;
      output.format = winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message, ...meta }) => timestamp + ' ' + level + ': ' + message + ' ' + JSON.stringify(meta)));
      selected.push(output);
    }
    if (file) for (const [filename, level] of [['error.log', 'error'], ['combined.log', threshold]]) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        selected.push((fileFactory || (options => new winston.transports.File(options)))({
          filename: path.join(logDir, filename), level, format: json(), maxsize: maxSize,
          maxFiles: 5, tailable: true, lazy: false,
        }));
      } catch { /* Other destinations remain usable. */ }
    }
  }
  const sanitize = winston.format(info => {
    const meta = safeMetadata(info);
    return { ...meta, level: info.level, message: eventMessage(meta), [Symbol.for('level')]: info.level };
  });
  const logger = winston.createLogger({ levels, level: 'debug', format: winston.format.combine(sanitize(), winston.format.timestamp(), winston.format.json()), transports: selected, exitOnError: false });
  const check = () => {
    if (selected.every(t => failed.has(t)) && !warned) {
      warned = true; logger.silent = true;
      try { report(OPERATIONAL_WARNING); } catch { /* Never recursively log a logging failure. */ }
    }
  };
  function disable(transport) {
    if (transport && !failed.has(transport)) {
      failed.add(transport); transport.silent = true; logger.remove(transport);
      if (transport.__winstonerror) transport.removeListener('error', transport.__winstonerror);
    }
    check();
  }
  logger.on('error', (_error, transport) => disable(transport));
  for (const transport of selected) transport.on('error', () => disable(transport));
  check();
  let closing;
  logger.shutdown = () => closing ||= new Promise(resolve => {
    // File transports emit finish only after their writable file has drained.
    const active = selected.filter(t => !failed.has(t));
    const drains = active.map(t => new Promise(done => {
      if (t.writableFinished || t.destroyed) return done();
      t.once('finish', done); t.once('error', done);
    }));
    logger.end();
    Promise.all(drains).then(() => { logger.close(); resolve(); });
  });
  return logger;
}
module.exports = { createLogger, DEFAULT_LOG_DIR, OPERATIONAL_WARNING };
