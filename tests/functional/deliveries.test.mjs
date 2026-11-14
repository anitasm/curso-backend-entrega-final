import { expect } from 'chai';
import request from 'supertest';
import { fixture, absentId, privateFailure } from '../support/fixture.mjs';
import { response, error, page, persisted } from '../support/responses.mjs';

describe('Deliveries: consultas de solo lectura', () => {
  let f, api;
  beforeEach(() => { f = fixture(); api = request(f.app); });
  afterEach(() => { f.dispose(); f = api = null; });
  it('lista, filtra y consulta por ID sin exigir driver en pending', async () => {
    const pending = f.seedDelivery(); f.seedDelivery({ status: 'assigned', driver: absentId }); f.seedDelivery();
    const list = await api.get('/api/deliveries?status=pending&limit=1&page=2');
    page(response(list, '/api/deliveries', 'get', 200));
    expect(list.body.payload).to.have.length(1); expect(list.body.totalPages).to.equal(2);
    expect(list.body.prevLink).to.equal('/api/deliveries?status=pending&limit=1&page=1'); expect(list.body.nextLink).to.equal(null);
    const found = await api.get('/api/deliveries/' + pending.id);
    const row = response(found, '/api/deliveries/{did}', 'get', 200).payload;
    persisted(row); expect(row).to.deep.equal(pending); expect(row).not.to.have.property('driver');
    expect(f.deliveries.size).to.equal(3);
  });
  it('lista vacía tiene página mínima 1', async () => {
    const r = await api.get('/api/deliveries'); page(response(r, '/api/deliveries', 'get', 200));
    expect(r.body.payload).to.deep.equal([]); expect(r.body.totalPages).to.equal(1);
  });
  it('filtro y paginación inválidos no consultan; warning comparte requestId', async () => {
    const r = await api.get('/api/deliveries?status=delivered'); error(r, '/api/deliveries', 'get', 'INVALID_DELIVERY_STATUS');
    error(await api.get('/api/deliveries?limit=101'), '/api/deliveries', 'get', 'VALIDATION_ERROR', 'limit no puede superar 100');
    expect(f.calls).to.deep.equal([]);
    const logged = f.logs.filter(l => l.event === 'http.error' && l.requestId === r.headers['x-request-id']);
    expect(logged).to.have.length(1); expect(logged[0]).to.include({ level: 'warning', code: 'INVALID_DELIVERY_STATUS', statusCode: 400 });
  });
  it('distingue ID mal formado de entrega inexistente', async () => {
    error(await api.get('/api/deliveries/bad'), '/api/deliveries/{did}', 'get', 'INVALID_ID'); expect(f.calls).to.deep.equal([]);
    error(await api.get('/api/deliveries/' + absentId), '/api/deliveries/{did}', 'get', 'DELIVERY_NOT_FOUND');
  });
  for (const [route, doc, name] of [['/api/deliveries', '/api/deliveries', 'list'], ['/api/deliveries/' + absentId, '/api/deliveries/{did}', 'get']]) it(name + ': falla de persistencia segura', async () => {
    f.faults['deliveries.' + name] = privateFailure(); error(await api.get(route), doc, 'get', 'DATABASE_ERROR');
  });
});
