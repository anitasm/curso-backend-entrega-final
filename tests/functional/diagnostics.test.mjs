import { expect } from 'chai';
import request from 'supertest';
import { fixture, config } from '../support/fixture.mjs';
import { response, error } from '../support/responses.mjs';

describe('Logger y Health: diagnóstico y entorno', () => {
  let f, api;
  beforeEach(() => { f = fixture(); api = request(f.app); });
  afterEach(() => { f.dispose(); f = api = null; });
  it('preload y configuración explícita no requieren variables externas', () => {
    expect(process.env.NODE_ENV).to.equal('test'); expect(config.nodeEnv).to.equal('test');
    expect(Object.hasOwn(config, 'mongoUri')).to.equal(false);
  });
  it('diagnóstico emite los seis niveles correlacionados y Health sigue disponible', async () => {
    const r = await api.get('/loggerTest');
    expect(response(r, '/loggerTest', 'get', 200)).to.deep.equal({ status: 'success', message: 'Logs de diagnóstico generados' });
    const events = f.logs.filter(l => l.event === 'logger.test');
    expect(events.map(l => l.level)).to.deep.equal(['debug', 'http', 'info', 'warning', 'error', 'fatal']);
    expect(events.every(l => l.synthetic && l.requestId === r.headers['x-request-id'])).to.equal(true);
    const health = await api.get('/api/health'); const body = response(health, '/api/health', 'get', 200);
    expect(body).to.have.all.keys('status', 'timestamp'); expect(body.status).to.equal('ok');
    expect(Number.isFinite(Date.parse(body.timestamp))).to.equal(true);
    expect(health.headers['x-request-id']).not.to.equal(r.headers['x-request-id']); expect(f.calls).to.deep.equal([]);
  });
  it('production bloquea Logger con 404 sin simulación', async () => {
    f.dispose(); f = fixture({ nodeEnv: 'production' }); api = request(f.app);
    error(await api.get('/loggerTest'), '/loggerTest', 'get', 'ROUTE_NOT_FOUND');
    expect(f.logs.some(l => l.event === 'logger.test')).to.equal(false);
    response(await api.get('/api/health'), '/api/health', 'get', 200);
  });
});
