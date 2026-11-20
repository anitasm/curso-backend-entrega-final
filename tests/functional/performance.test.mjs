import { expect } from 'chai';
import request from 'supertest';
import { fixture } from '../support/fixture.mjs';
import { error, response } from '../support/responses.mjs';
import createApp from '../../src/app.js';

describe('Límites y liveness', () => {
  for (const route of ['/api/users', '/api/orders', '/api/deliveries']) it(route + ': offset inseguro rechazado antes del repositorio', async () => {
    const f = fixture();
    try {
      const r = await request(f.app).get(route + '?page=100000000000000&limit=100');
      error(r, route, 'get', 'VALIDATION_ERROR', 'El desplazamiento de paginación debe ser un entero seguro');
      expect(f.calls).to.deep.equal([]);
    } finally { f.dispose(); }
  });
  for (const nodeEnv of ['development', 'test', 'production', undefined]) it('health explícito sin secretos: ' + nodeEnv, async () => {
    const r = await request(createApp({ nodeEnv })).get('/api/health');
    const body = response(r, '/api/health', 'get', 200);
    expect(body).to.have.all.keys('status', 'environment', 'uptime', 'timestamp');
    expect(body.status).to.equal('ok'); expect(body.environment).to.equal(nodeEnv || 'development');
    expect(body.uptime).to.be.a('number').and.at.least(0); expect(Number.isFinite(body.uptime)).to.equal(true);
    expect(new Date(body.timestamp).toISOString()).to.equal(body.timestamp);
  });
});
