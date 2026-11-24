// Optional acceptance check: owns a fresh project; never uses an existing project's volumes.
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const project = 'shipnow-review-' + randomUUID();
let env = { ...process.env }, base;
const compose = ['compose', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null', '-p', project, '-f', path.join(root, 'docker-compose.yml')];
function docker(args, capture = false, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = ''; if (capture) { child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d); }
    const timer = setTimeout(() => { child.kill(); reject(new Error('Docker timeout')); }, timeout);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Docker exit ' + code + ': ' + output)); });
  });
}
const run = (...args) => docker([...compose, ...args]);
async function http(route, options = {}, status = 200) { const r = await fetch(base + route, { ...options, signal: AbortSignal.timeout(10000) }); assert.equal(r.status, status, route); return r; }
async function post(route, body, status = 201) { return (await (await http(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, status)).json()).payload; }
async function ready() { for (let n = 0; n < 60; n++) { try { await http('/api/health'); return; } catch { await new Promise(r => setTimeout(r, 1000)); } } throw new Error('API readiness timeout'); }
(async () => {
  let started = false;
  try {
    const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
    env.COMPOSE_HTTP_PORT = String(port); base = 'http://127.0.0.1:' + port;
    console.log('Verification project: ' + project + ' at ' + base);
    await run('config', '--quiet'); started = true; await run('up', '-d', '--build', '--wait', '--wait-timeout', '180'); await ready();
    const services = JSON.parse(await docker([...compose, 'ps', '--all', '--format', 'json'], true).then(s => '[' + s.split('\n').filter(Boolean).join(',') + ']'));
    assert.ok(services.some(s => s.Service === 'mongo' && s.Health === 'healthy'));
    assert.ok(services.some(s => s.Service === 'api' && s.Health === 'healthy'));
    assert.ok(services.some(s => s.Service === 'mongo-init' && s.ExitCode === 0));
    const health = await (await http('/api/health')).json(); assert.equal(health.environment, 'production');
    await http('/api/docs/'); const spec = await (await http('/api/docs/openapi.json')).json(); assert.ok(spec.paths['/api/orders/{oid}/tracking']);
    await http('/loggerTest', {}, 404); await http('/api/mocks/users', {}, 404);
    const user = await post('/api/users', { firstName: 'Review', lastName: 'Ficticio', email: 'review@example.test' });
    const driver = await post('/api/users', { firstName: 'Driver', lastName: 'Ficticio', email: 'driver@example.test', role: 'driver' });
    const order = await post('/api/orders', { customer: user.id, items: [{ name: 'Ficticio', quantity: 2, price: 4 }], deliveryAddress: 'Dirección ficticia 1' });
    await post('/api/deliveries', { order: order.id, driver: driver.id });
    const form = new FormData(); form.set('type', 'user_document'); form.set('document', new Blob(['%PDF-1.4\nFictitious review\n%%EOF'], { type: 'application/pdf' }), 'review.pdf');
    const file = (await (await http('/api/users/' + user.id + '/documents', { method: 'POST', body: form }, 201)).json()).payload.document;
    const inspect = "const fs=require('fs'),assert=require('assert/strict'); assert.notEqual(process.getuid(),0); for(const p of ['.env','.git','tests','test','scripts','postman','node_modules/mocha','node_modules/chai','node_modules/supertest'])assert.ok(!fs.existsSync('/app/'+p),p); for(const p of ['uploads','src/public/img/uploads','logs'])fs.accessSync('/app/'+p,fs.constants.W_OK); const files=fs.readdirSync('/app/src/public/img/catalog-legacy'); assert.equal(files.length,5); console.log(files[0]);";
    const legacy = await docker([...compose, 'exec', '-T', 'api', 'node', '-e', inspect], true);
    await http('/img/uploads/' + legacy);
    await run('up', '-d', '--no-deps', '--force-recreate', 'api'); await ready();
    assert.equal((await (await http('/api/orders/' + order.id)).json()).payload.status, 'assigned');
    const checkFile = "const fs=require('fs'),assert=require('assert/strict'); const bytes=fs.readFileSync('/app/' + process.argv[1]);assert.ok(bytes.toString().startsWith('%PDF-'));";
    await run('exec', '-T', 'api', 'node', '-e', checkFile, file.path);
    await run('stop');
    const apiId = await docker([...compose, 'ps', '--all', '-q', 'api'], true);
    assert.equal(await docker(['inspect', '--format', '{{.State.ExitCode}}', apiId], true), '0');
    assert.equal(await docker(['logs', apiId], true), '');
    // Bring up the same volumes; mongo-init must accept the existing configuration.
    await run('up', '-d', '--wait', '--wait-timeout', '180'); await ready();
    await http('/api/users/' + user.id);
    await run('exec', '-T', 'api', 'node', '-e', "const fs=require('fs'),a=require('assert/strict'); for(const name of ['combined.log','error.log']){const rows=fs.readFileSync('/app/logs/'+name,'utf8').split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse); if(name==='combined.log')a.ok(rows.some(r=>r.event==='server.started'));else a.ok(rows.every(r=>['error','fatal'].includes(r.level)));} console.log('Persistent logs verified');");
    console.log('Compose acceptance passed: PRIMARY, health, HTTP, persistent uploads, restart, non-root image and quiet shutdown.');
  } catch (error) { process.exitCode = 1; console.error(error.message); }
  finally { if (started) { try { await run('down', '--timeout', '20'); } catch { process.exitCode = 1; } console.log('Review volumes preserved under project ' + project); } }
})();
