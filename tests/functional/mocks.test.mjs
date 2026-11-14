import { expect } from 'chai';
import request from 'supertest';
import AppError from '../../src/errors/AppError.js';
import { fixture, batchInput, privateFailure, duplicate } from '../support/fixture.mjs';
import { response, error, persisted } from '../support/responses.mjs';

describe('Mocks: vistas previas y transacciones simuladas aisladas', () => {
  let f, api;
  beforeEach(() => { f = fixture(); api = request(f.app); });
  afterEach(() => { f.dispose(); f = api = null; });
  const replace = options => { f.dispose(); f = fixture(options); api = request(f.app); };
  for (const name of ['users', 'mockingusers', 'mockingdrivers', 'mockingorders', 'mockingdeliveries']) {
    const route = '/api/mocks/' + name;
    it('GET ' + name + ': estructura, cantidad y ausencia de persistencia', async () => {
      const r = await api.get(route + '?qty=2'); const body = response(r, route, 'get', 200);
      const rows = name === 'users' ? body : body.payload;
      expect(rows).to.be.an('array').with.length(2);
      if (name !== 'users') expect(body).to.have.all.keys('status', 'payload');
      for (const row of rows) {
        expect(row).not.to.have.any.keys('_id', 'id', 'createdAt', 'updatedAt');
        if (name === 'users') expect(row).to.have.all.keys('nombre', 'email', 'rol');
        if (name === 'mockingdrivers') expect(row.role).to.equal('driver');
        if (name === 'mockingorders') { expect(row.items).to.be.an('array').that.is.not.empty; expect(row.total).to.equal(row.items.reduce((n, i) => n + i.quantity * i.price, 0)); }
        if (name === 'mockingdeliveries') { expect(row.status).to.equal('pending'); expect(row).not.to.have.property('driver'); }
      }
      expect(f.mocks.calls).to.deep.equal([]); expect(f.calls).to.deep.equal([]);
    });
    it('GET ' + name + ': cantidades y campos inválidos', async () => {
      error(await api.get(route + '?qty=-1'), route, 'get', 'INVALID_MOCK_AMOUNT', 'qty debe ser un entero decimal entre 1 y 100');
      error(await api.get(route + '?qty=101'), route, 'get', 'INVALID_MOCK_AMOUNT', 'qty debe estar entre 1 y 100');
      error(await api.get(route + '?extra=1'), route, 'get', 'INVALID_MOCK_DATA', 'Campo no permitido');
      expect(f.mocks.calls).to.deep.equal([]);
    });
    it('GET ' + name + ': producción conserva 404', async () => {
      replace({ nodeEnv: 'production' }); error(await api.get(route), route, 'get', 'ROUTE_NOT_FOUND'); expect(f.mocks.calls).to.deep.equal([]);
    });
  }
  for (const name of ['users', 'seed', 'generateData']) {
    const route = '/api/mocks/' + name;
    const send = () => name === 'generateData' ? api.post(route).send(batchInput()) : api.post(route + '?qty=2');
    it('POST ' + name + ': 201 con conteos confirmados y un solo éxito', async () => {
      const r = await send(); const body = response(r, route, 'post', 201);
      if (name === 'seed') expect(body).to.deep.equal({ insertados: 2, coleccion: 'usuarios' });
      else if (name === 'users') {
        expect(body).to.have.all.keys('status', 'payload'); expect(body.payload).to.have.all.keys('inserted', 'users', 'collection');
        expect(body.payload.inserted).to.equal(2); expect(body.payload.collection).to.equal('users'); body.payload.users.forEach(persisted);
      } else expect(body).to.deep.equal({ status: 'success', payload: { insertados: { users: 1, drivers: 1, orders: 1, deliveries: 1 } } });
      expect(f.mocks.committed()).to.equal(true);
      const successes = f.logs.filter(l => l.event === 'mocks.committed'); expect(successes).to.have.length(1);
      expect(successes[0].requestId).to.equal(r.headers['x-request-id']);
    });
    it('POST ' + name + ': entradas inválidas antes del guard', async () => {
      if (name === 'generateData') {
        error(await api.post(route).send({}), route, 'post', 'INVALID_MOCK_AMOUNT', 'El lote debe contener entre 1 y 100 registros en total');
        error(await api.post(route).send({ orders: 1 }), route, 'post', 'INVALID_MOCK_DATA', 'Para generar pedidos se requiere al menos un cliente (users)');
        error(await api.post(route + '?extra=1').send(batchInput()), route, 'post', 'INVALID_MOCK_DATA', 'Campo no permitido');
        error(await api.post(route).type('text').send('body'), route, 'post', 'INVALID_MOCK_DATA', 'generateData requiere un body JSON');
      } else {
        error(await api.post(route + '?qty=-1'), route, 'post', 'INVALID_MOCK_AMOUNT', 'qty debe ser un entero decimal entre 1 y 100');
        error(await api.post(route + '?extra=1'), route, 'post', 'INVALID_MOCK_DATA', 'Campo no permitido');
      }
      expect(f.mocks.calls).to.deep.equal([]);
    });
    it('POST ' + name + ': parser rechaza JSON roto y exceso de tamaño', async () => {
      error(await api.post(route).type('json').send('{"users":'), route, 'post', 'INVALID_JSON');
      error(await api.post(route).send({ data: 'x'.repeat(110000) }), route, 'post', 'PAYLOAD_TOO_LARGE');
      expect(f.mocks.calls).to.deep.equal([]);
    });
    it('POST ' + name + ': guard devuelve 403 sin transacción', async () => {
      replace({ forbidden: true }); error(await send(), route, 'post', 'MOCK_DATABASE_FORBIDDEN');
      expect(f.mocks.calls).to.deep.equal(['guard']);
    });
    it('POST ' + name + ': producción no monta la ruta', async () => {
      replace({ nodeEnv: 'production' }); error(await send(), route, 'post', 'ROUTE_NOT_FOUND'); expect(f.mocks.calls).to.deep.equal([]);
    });
    it('POST ' + name + ': conflicto de email traduce el error del repositorio', async () => {
      f.faults['mocks.users'] = duplicate('email'); error(await send(), route, 'post', 'USER_ALREADY_EXISTS');
      expect(f.mocks.committed()).to.equal(false); expect(f.logs.some(l => l.event === 'mocks.committed')).to.equal(false);
    });
    it('POST ' + name + ': fallo definitivo no anuncia éxito', async () => {
      f.faults['mocks.' + (name === 'generateData' ? 'deliveries' : 'users')] = privateFailure();
      error(await send(), route, 'post', 'MOCK_GENERATION_ERROR');
      expect(f.mocks.calls).to.include('abort'); expect(f.mocks.committed()).to.equal(false);
      expect(f.logs.some(l => l.event === 'mocks.committed')).to.equal(false);
    });
    it('POST ' + name + ': transacción no soportada devuelve 503', async () => {
      // The transaction adapter translates the driver's standalone error to this AppError.
      // Its actual translation and rollback are covered in the regression/integration suites.
      f.faults.transaction = new AppError('MOCK_TRANSACTIONS_REQUIRED', { cause: privateFailure() });
      error(await send(), route, 'post', 'MOCK_TRANSACTIONS_REQUIRED'); expect(f.calls).to.deep.equal([]);
    });
    it('POST ' + name + ': error de esquema produce 400 público', async () => {
      f.faults['mocks.users'] = Object.assign(privateFailure(), { name: 'ValidationError' });
      error(await send(), route, 'post', 'VALIDATION_ERROR'); expect(f.mocks.committed()).to.equal(false);
    });
  }
  it('seed exige qty mientras users usa 10 por defecto', async () => {
    error(await api.post('/api/mocks/seed'), '/api/mocks/seed', 'post', 'INVALID_MOCK_AMOUNT', 'qty debe ser un entero decimal entre 1 y 100');
    const r = await api.post('/api/mocks/users'); response(r, '/api/mocks/users', 'post', 201); expect(r.body.payload.inserted).to.equal(10);
  });
});
