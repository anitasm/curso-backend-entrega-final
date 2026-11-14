const path = require('node:path');
const fs = require('node:fs');
const { levels, safeMetadata, eventMessage } = require('./log-events');
const DEFAULT_LOG_DIR = path.resolve(__dirname, '../../logs');
const OPERATIONAL_WARNING = 'warning: No se pudo escribir un destino de logs; continúa el servicio.\n';

// Importing this module does not load configuration or open any transport.
function createLogger({ nodeEnv = 'development', logDir = DEFAULT_LOG_DIR, file = true,
  consoleTransport, transports, maxSize = '10m', report = text => process.stderr.write(text),
  fileFactory } = {}) {
  const winston = require('winston');
  const DailyRotateFile = require('winston-daily-rotate-file');
  let warned = false;
  const warn = () => { if (!warned) { warned = true; try { report(OPERATIONAL_WARNING); } catch { /* No recursive logging. */ } } };
  const failed = new Set();
  const files = [];
  const selected = transports ? [...transports] : [];
  const jsonFormat = () => winston.format.combine(winston.format.timestamp(), winston.format.json());
  if (!transports) {
    const output = consoleTransport || new winston.transports.Console({ stderrLevels: ['fatal'] });
    output.level = nodeEnv === 'production' ? 'info' : 'debug';
    output.format = nodeEnv === 'production' ? jsonFormat() : winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => `${timestamp} ${level}: ${message} ${JSON.stringify(meta)}`),
    );
    selected.push(output);
    if (file) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        const destination = (fileFactory || (options => new DailyRotateFile(options)))({
          dirname: logDir, filename: 'errors-%DATE%.log', datePattern: 'YYYY-MM-DD',
          maxSize, maxFiles: '14d', auditFile: path.join(logDir, '.errors-audit.json'),
          level: 'error', format: jsonFormat(), createSymlink: false,
        });
        selected.push(destination);
        files.push(destination);
      } catch { warn(); }
    }
  }
  const sanitize = winston.format(info => {
    const meta = safeMetadata(info);
    return { ...meta, level: info.level, message: eventMessage(meta), [Symbol.for('level')]: info.level };
  });
  const logger = winston.createLogger({ levels, level: 'debug', format: winston.format.combine(sanitize(), winston.format.timestamp(), winston.format.json()), transports: selected, exitOnError: false });
  function disable(transport) {
    warn();
    if (!transport || failed.has(transport)) return;
    failed.add(transport);
    transport.silent = true;
    logger.remove(transport);
    // Winston otherwise re-adds a removed transport when a later error bubbles.
    if (transport.__winstonerror) transport.removeListener('error', transport.__winstonerror);
  }
  logger.on('error', (_error, transport) => disable(transport));
  for (const transport of selected) {
    transport.on('error', () => disable(transport));
    // DailyRotateFile 5 also exposes errors from its underlying rotating stream.
    transport.logStream?.on('error', () => disable(transport));
  }
  let closing;
  logger.shutdown = () => {
    if (closing) return closing;
    closing = (async () => {
      await new Promise(resolve => {
        if (logger.writableFinished) return resolve();
        logger.once('finish', resolve);
        logger.end();
      });
      // Finish means Winston delivered its queue; flush the file streams too.
      await Promise.all(files.filter(t => !failed.has(t)).map(t => new Promise(resolve => {
        t.logStream.once('error', resolve);
        t.logStream.end(() => { t.logStream.removeListener('error', resolve); resolve(); });
      })));
      logger.close();
    })();
    return closing;
  };
  return logger;
}
module.exports = { createLogger, DEFAULT_LOG_DIR, OPERATIONAL_WARNING };
