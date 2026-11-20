const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const [mode, code, marker] of [['portable', 0, 'drained-safe'], ['db-failure', 1, 'failure-safe'], ['deadline', 1, 'deadline-safe'], ['signal', 0, 'drained-safe']]) {
  test('Cierre: ' + mode + ' con HTTP/Socket.IO reales y base aislada', { skip: mode === 'signal' && process.platform === 'win32' ? 'SIGTERM real requiere Linux; verificar también docker stop' : false }, () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'helpers/shutdown-child.js'), mode], { encoding: 'utf8', timeout: 7000 });
    assert.equal(result.status, code, result.stderr + result.stdout); assert.match(result.stdout, new RegExp(marker));
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_TOKEN|synthetic.invalid/);
  });
}
