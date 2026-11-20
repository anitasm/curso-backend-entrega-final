// Docker liveness probe; no configuration loader, credentials, logging or DB access.
const http = require('node:http');
const request = http.get({ hostname: '127.0.0.1', port: process.env.PORT || 8080, path: '/api/health', timeout: 3000 }, response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) request.destroy(new Error('Health response too large'));
  });
  response.on('error', () => { process.exitCode = 1; });
  response.on('end', () => {
    try { if (response.statusCode !== 200 || JSON.parse(body).status !== 'ok') process.exitCode = 1; }
    catch { process.exitCode = 1; }
  });
});
request.on('timeout', () => request.destroy());
request.on('error', () => { process.exitCode = 1; });
