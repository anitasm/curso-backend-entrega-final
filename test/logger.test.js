const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const winston = require('winston');
const { createLogger, OPERATIONAL_WARNING } = require('../src/utils/logger');
const { levels, logEvent } = require('../src/utils/log-events');
const sequence = ['debug', 'http', 'info', 'warning', 'error', 'fatal'];
function output() { const stream = new PassThrough(); let text = ''; stream.on('data', c => text += c); return { stream, transport: new winston.transports.Stream({ stream }), text: () => text }; }
async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipnow-logs-')); t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })); return dir; }
async function rows(dir, name) { return (await fs.readFile(path.join(dir, name), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
test('Winston: seis niveles; consola solo development; dos archivos JSON en todos los entornos', async t => {
  assert.deepEqual(levels, { fatal: 0, error: 1, warning: 2, info: 3, http: 4, debug: 5 });
  for (const nodeEnv of ['development', 'test', 'production']) {
    const logDir = await directory(t), out = output();
    const logger = createLogger({ nodeEnv, logDir, consoleTransport: out.transport });
    for (const level of sequence) logEvent(level, 'logger.test', { synthetic: true }, logger);
    await logger.shutdown();
    assert.equal(out.text().split(/\r?\n/).filter(Boolean).length, nodeEnv === 'development' ? 6 : 0);
    assert.deepEqual((await rows(logDir, 'error.log')).map(r => r.level), ['error', 'fatal']);
    const combined = await rows(logDir, 'combined.log');
    assert.deepEqual(combined.map(r => r.level), nodeEnv === 'production' ? sequence.slice(2) : sequence);
    assert.ok(combined.every(r => Number.isFinite(Date.parse(r.timestamp)) && r.synthetic && r.event === 'logger.test'));
    assert.deepEqual((await fs.readdir(logDir)).sort(), ['combined.log', 'error.log']); out.stream.destroy();
  }
});
test('Winston: rotación acotada a cinco archivos por destino, JSON íntegro y cierre drenado', async t => {
  const logDir = await directory(t);
  const logger = createLogger({ nodeEnv: 'test', logDir, maxSize: 1000 });
  for (let i = 0; i < 100; i++) { logEvent('error', 'logger.test', { users: i }, logger); await new Promise(r => setTimeout(r, 5)); }
  await logger.shutdown();
  const names = await fs.readdir(logDir);
  for (const base of ['error', 'combined']) {
    const files = names.filter(n => n.startsWith(base)); assert.ok(files.length > 1 && files.length <= 5);
    assert.ok(files.includes(base + '.log'));
    const records = (await Promise.all(files.map(n => rows(logDir, n)))).flat();
    assert.ok(records.length); assert.ok(records.every(r => r.level === 'error')); assert.ok(records.some(r => r.users === 99));
  }
});
test('Winston: un archivo fallido no emite stderr si la consola sigue disponible', async t => {
  const dir = await directory(t), logDir = path.join(dir, 'occupied'); await fs.writeFile(logDir, 'fixture');
  const out = output(), warnings = [], logger = createLogger({ logDir, consoleTransport: out.transport, report: s => warnings.push(s) });
  logEvent('info', 'server.started', { port: 8080 }, logger); await logger.shutdown();
  assert.deepEqual(warnings, []); assert.match(out.text(), /server.started/); out.stream.destroy();
});
test('Winston: fallo asíncrono aislado; aviso constante solo al perder todos los destinos', async t => {
  const logDir = await directory(t), warnings = [], logger = createLogger({ nodeEnv: 'test', logDir, report: s => warnings.push(s) });
  const [first, second] = [...logger.transports];
  first.emit('error', new Error('private-secret')); assert.deepEqual(warnings, []);
  logEvent('info', 'server.started', { port: 8080 }, logger);
  second.emit('error', new Error('private-secret')); second.emit('error', new Error('private-secret'));
  await logger.shutdown(); assert.deepEqual(warnings, [OPERATIONAL_WARNING]);
  first.close(); second.close();
});
test('Winston: solo metadatos seguros y mensajes del diccionario llegan al archivo', async t => {
  const logDir = await directory(t), logger = createLogger({ nodeEnv: 'production', logDir });
  const secret = 'mongodb://private:secret@host token@example.test';
  logger.error(secret, { event: 'http.error', code: 'DATABASE_ERROR', method: 'GET', statusCode: 500, body: secret, cause: new Error(secret), requestId: secret, operation: secret, stack: secret });
  await logger.shutdown(); const [row] = await rows(logDir, 'error.log');
  assert.doesNotMatch(JSON.stringify(row), /private|secret|token@example/);
  assert.deepEqual(Object.keys(row).sort(), ['code', 'event', 'level', 'message', 'method', 'statusCode', 'timestamp']);
});
test('Winston: LOG_LEVEL fatal limita combined sin perder error en error.log', async t => {
  const logDir = await directory(t), logger = createLogger({ nodeEnv: 'production', logLevel: 'fatal', logDir });
  for (const level of sequence) logEvent(level, 'logger.test', { synthetic: true }, logger);
  await logger.shutdown(); assert.deepEqual((await rows(logDir, 'combined.log')).map(r => r.level), ['fatal']);
  assert.deepEqual((await rows(logDir, 'error.log')).map(r => r.level), ['error', 'fatal']);
});
