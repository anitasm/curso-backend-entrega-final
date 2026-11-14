const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { createLogger, OPERATIONAL_WARNING } = require('../src/utils/logger');
const { levels, logEvent } = require('../src/utils/log-events');
const sequence = ['debug', 'http', 'info', 'warning', 'error', 'fatal'];
function output() {
  const stream = new PassThrough();
  let text = '';
  stream.on('data', chunk => { text += chunk; });
  return { stream, transport: new winston.transports.Stream({ stream }), text: () => text };
}
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipnow-logs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}
async function records(dir) {
  const files = (await fs.readdir(dir)).filter(name => /^errors-.*\.log(?:\.\d+)?$/.test(name));
  const content = await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8')));
  return { files, rows: content.join('\n').split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}

test('Winston: niveles exactos, consola por entorno y archivo solo error/fatal', async t => {
  assert.deepEqual(levels, { fatal: 0, error: 1, warning: 2, info: 3, http: 4, debug: 5 });
  for (const nodeEnv of ['development', 'production']) {
    const logDir = await directory(t);
    const out = output();
    const logger = createLogger({ nodeEnv, logDir, consoleTransport: out.transport });
    for (const level of sequence) logEvent(level, 'logger.test', { synthetic: true }, logger);
    await logger.shutdown();
    const lines = out.text().trim().split(/\r?\n/);
    assert.equal(lines.length, nodeEnv === 'production' ? 4 : 6);
    if (nodeEnv === 'production') assert.deepEqual(lines.map(x => JSON.parse(x).level), ['info', 'warning', 'error', 'fatal']);
    else for (const level of sequence) assert.match(out.text(), new RegExp(` ${level}: `));
    const { rows } = await records(logDir);
    assert.deepEqual(rows.map(x => x.level), ['error', 'fatal']);
    for (const row of rows) {
      assert.equal(row.event, 'logger.test'); assert.equal(row.synthetic, true);
      assert.ok(Number.isFinite(Date.parse(row.timestamp))); assert.equal(typeof row.message, 'string');
    }
    const audit = JSON.parse(await fs.readFile(path.join(logDir, '.errors-audit.json'), 'utf8'));
    assert.deepEqual(audit.keep, { days: true, amount: 14 });
    out.stream.destroy();
  }
});

test('Winston: rotación por tamaño conserva JSON completo y vacía al cerrar', async t => {
  const logDir = await directory(t);
  const out = output();
  const logger = createLogger({ logDir, consoleTransport: out.transport, maxSize: '1k' });
  const file = logger.transports.find(x => x instanceof DailyRotateFile);
  const rotated = once(file, 'rotate');
  for (let i = 0; i < 70; i++) logEvent('error', 'logger.test', { synthetic: true, users: i }, logger);
  await rotated;
  await logger.shutdown();
  const { rows, files } = await records(logDir);
  assert.ok(files.length > 1);
  assert.equal(rows.length, 70);
  assert.deepEqual(rows.map(x => x.users).sort((a,b) => a-b), Array.from({ length: 70 }, (_, i) => i));
  assert.ok(rows.every(x => x.level === 'error'));
  out.stream.destroy();
});

test('Winston: falla al crear archivo mantiene consola con un aviso seguro', async t => {
  const dir = await directory(t);
  const occupied = path.join(dir, 'occupied');
  await fs.writeFile(occupied, 'fixture');
  const warnings = [];
  const out = output();
  const logger = createLogger({ logDir: occupied, consoleTransport: out.transport, report: message => warnings.push(message) });
  logEvent('info', 'server.started', { port: 8080 }, logger);
  await logger.shutdown();
  assert.deepEqual(warnings, [OPERATIONAL_WARNING]);
  assert.match(out.text(), /server.started/);
  assert.ok(!warnings.join('').includes(dir));
  out.stream.destroy();
});

test('Winston: error asíncrono de archivo se aísla sin recursión', async t => {
  const dir = await directory(t);
  const out = output();
  const warnings = [];
  let file;
  const logger = createLogger({ logDir: dir, consoleTransport: out.transport, report: value => warnings.push(value),
    fileFactory: options => (file = new DailyRotateFile({ ...options, options: { flags: 'r' } })),
  });
  await new Promise(resolve => file.logStream.once('error', resolve));
  file.emit('error', new Error('mongodb://private:secret@host token@example.test'));
  logEvent('info', 'server.started', { port: 8080 }, logger);
  await logger.shutdown();
  assert.deepEqual(warnings, [OPERATIONAL_WARNING]);
  assert.match(out.text(), /server.started/);
  assert.doesNotMatch(out.text() + warnings.join(''), /private|secret|token@example/);
  out.stream.destroy();
});

test('Winston: el formato permite solo metadatos seguros, nunca mensajes arbitrarios', async () => {
  const out = output();
  const logger = createLogger({ nodeEnv: 'production', file: false, consoleTransport: out.transport });
  const secret = 'mongodb://private:secret@host token@example.test';
  logger.error(secret, { event: 'http.error', code: 'DATABASE_ERROR', method: 'GET', statusCode: 500, body: secret, cause: new Error(secret), requestId: secret, operation: secret, stack: secret });
  await logger.shutdown();
  const row = JSON.parse(out.text());
  assert.doesNotMatch(out.text(), /private|secret|token@example/);
  assert.deepEqual(Object.keys(row).sort(), ['code', 'event', 'level', 'message', 'method', 'statusCode', 'timestamp']);
  out.stream.destroy();
});
