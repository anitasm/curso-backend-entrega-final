const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixture = path.resolve(__dirname, 'helpers/logging-startup-child.js');

test('Logging de arranque: fatal persistido una vez y cierre de recursos por etapa', async t => {
  for (const [mode, code] of [
    ['config', 'STARTUP_CONFIGURATION_ERROR'], ['connection', 'STARTUP_DATABASE_ERROR'],
    ['prepare', 'STARTUP_PREPARATION_ERROR'], ['occupied', 'STARTUP_PORT_IN_USE'],
    ['terminal', 'SERVER_TERMINAL_ERROR'], ['success', null],
  ]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipnow-startup-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }));
    const child = spawnSync(process.execPath, [fixture, mode, dir], {
      env: { ...process.env, NODE_ENV: 'test', PORT: mode === 'config' ? '' : '8080', MONGODB_URI: 'mongodb://private:secret@example.test/private' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, mode === 'success' ? 0 : 1, child.stderr);
    const files = ['error.log'];
    const lines = (await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8')))).join('\n');
    const rows = lines.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.doesNotMatch(child.stdout + child.stderr + lines, /private|secret|example.test/);
    assert.equal(rows.length, code ? 1 : 0);
    if (code) { assert.equal(rows[0].level, 'fatal'); assert.equal(rows[0].code, code); }
    const combined = await fs.readFile(path.join(dir, 'combined.log'), 'utf8');
    assert.equal(child.stdout + child.stderr, '');
    assert.equal((combined.match(/database.connected/g) || []).length, ['config', 'connection'].includes(mode) ? 0 : 1);
    assert.equal((combined.match(/server.started/g) || []).length, ['terminal', 'success'].includes(mode) ? 1 : 0);
  }
});

test('Importación de app y logger no abre archivos ni inicializa configuración', () => {
  const app = path.resolve(__dirname, '../src/app.js');
  const logger = path.resolve(__dirname, '../src/utils/logger.js');
  const code = `const fs=require('node:fs'); fs.createWriteStream=()=>{throw Error('write forbidden')}; fs.mkdirSync=()=>{throw Error('mkdir forbidden')}; require(${JSON.stringify(app)}); require(${JSON.stringify(logger)}); if(Object.keys(require.cache).some(p=>/mongoose|env.config/.test(p)))process.exitCode=2;`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout + child.stderr, '');
});
