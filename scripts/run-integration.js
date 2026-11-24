const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const project = 'shipnow-test-' + randomUUID();
const args = ['compose', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null', '--project-directory', root, '-p', project, '-f', path.join(root, 'docker-compose.test.yml')];
let child, interrupted = false;
function run(command, timeout = 600000) {
  return new Promise((resolve, reject) => {
    child = spawn('docker', command, { cwd: root, shell: false, stdio: 'inherit', env: process.env });
    const current = child;
    const timer = setTimeout(() => { current.kill(); reject(new Error('Docker operation timed out')); }, timeout);
    current.once('error', error => { clearTimeout(timer); reject(error); });
    current.once('exit', (code, signal) => { clearTimeout(timer); child = undefined; code === 0 ? resolve() : reject(new Error('Docker returned ' + (code ?? signal))); });
  });
}
const signal = () => { interrupted = true; child?.kill(); };
process.on('SIGINT', signal); process.on('SIGTERM', signal);
(async () => {
  let started = false;
  try {
    await run(['info', '--format', '{{.ServerVersion}}'], 30000);
    await run(['compose', 'version'], 30000);
    started = true;
    await run([...args, 'up', '-d', 'mongo']);
    if (interrupted) throw new Error('Interrupted');
    await run([...args, 'run', '--rm', '--no-deps', 'mongo-init'], 120000);
    await run([...args, 'up', '-d', '--no-recreate', '--wait', '--wait-timeout', '120', 'mongo']);
    await run([...args, 'build', 'tests']);
    if (interrupted) throw new Error('Interrupted');
    await run([...args, 'run', '--rm', '--no-deps', 'tests']);
  } catch (error) {
    process.exitCode = 1;
    console.error('Integration tests failed: ' + error.message + '. Docker Desktop (Linux containers), Compose and Docker on PATH are required. No external database is used.');
  } finally {
    // Only this randomly named, exclusively owned test project is removed.
    if (started) try { await run([...args, 'down', '--volumes', '--rmi', 'local', '--remove-orphans', '--timeout', '20'], 90000); }
    catch { process.exitCode = 1; console.error('Cleanup failed for exclusive test project ' + project); }
    process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
    if (interrupted) process.exitCode = 1;
  }
})();
