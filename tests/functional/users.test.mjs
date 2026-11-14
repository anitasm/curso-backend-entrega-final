import { expect } from 'chai';
import request from 'supertest';
import { fixture, userInput, absentId, privateFailure } from '../support/fixture.mjs';
import { response, error, page, persisted } from '../support/responses.mjs';

describe('Users: API real con repositorios efímeros', () => {
  let f, api;
  beforeEach(() => { f = fixture(); api = request(f.app); });
  afterEach(() => { f.dispose(); f = api = null; });
  const create = async () => {
    const r = await api.post('/api/users').send(userInput);
    response(r, '/api/users', 'post', 201);
    return r.body.payload;
  };
  it('crea, lista, consulta, actualiza y elimina un perfil dentro del mismo caso', async () => {
    const user = await create(); persisted(user);
    expect(user).to.include({ ...userInput, role: 'user' }); expect(user).not.to.have.property('password');
    const list = await api.get('/api/users'); page(response(list, '/api/users', 'get', 200));
    expect(list.body.payload).to.have.length(1);
    const found = await api.get('/api/users/' + user.id);
    expect(response(found, '/api/users/{uid}', 'get', 200).payload).to.deep.equal(user);
    const updated = await api.put('/api/users/' + user.id).send({ firstName: ' Luz ' });
    expect(response(updated, '/api/users/{uid}', 'put', 200).payload.firstName).to.equal('Luz');
    const removed = await api.delete('/api/users/' + user.id);
    expect(response(removed, '/api/users/{uid}', 'delete', 200).payload.firstName).to.equal('Luz');
    error(await api.get('/api/users/' + user.id), '/api/users/{uid}', 'get', 'USER_NOT_FOUND');
  });
  it('pagina sin depender de casos anteriores y acepta lista vacía', async () => {
    const empty = await api.get('/api/users'); page(response(empty, '/api/users', 'get', 200));
    expect(empty.body.payload).to.deep.equal([]); expect(empty.body.totalPages).to.equal(1);
    await create(); await api.post('/api/users').send({ ...userInput, email: 'otra@example.test' });
    const r = await api.get('/api/users?page=2&limit=1'); page(response(r, '/api/users', 'get', 200));
    expect(r.body.payload).to.have.length(1); expect(r.body.prevLink).to.equal('/api/users?page=1&limit=1'); expect(r.body.nextLink).to.equal(null);
  });
  it('rechaza paginación inválida antes de leer', async () => {
    error(await api.get('/api/users?limit=101'), '/api/users', 'get', 'VALIDATION_ERROR', 'limit no puede superar 100');
    expect(f.calls).to.deep.equal([]);
  });
  for (const [data, message] of [[{}, 'firstName debe ser texto no vacío'], [{ ...userInput, role: 'admin' }, 'Campo no permitido'], [{ ...userInput, password: 'x' }, 'Campo no permitido'], [{ ...userInput, email: 'bad' }, 'email inválido']]) {
    it('rechaza alta inválida: ' + JSON.stringify(data), async () => {
      error(await api.post('/api/users').send(data), '/api/users', 'post', 'VALIDATION_ERROR', message);
      expect(f.calls).to.deep.equal([]);
    });
  }
  it('devuelve conflicto al repetir email en alta y edición', async () => {
    await create();
    error(await api.post('/api/users').send(userInput), '/api/users', 'post', 'USER_ALREADY_EXISTS');
    const other = await api.post('/api/users').send({ ...userInput, email: 'otra@example.test' });
    error(await api.put('/api/users/' + other.body.payload.id).send({ email: userInput.email }), '/api/users/{uid}', 'put', 'USER_ALREADY_EXISTS');
  });
  it('rechaza actualización vacía', async () => {
    error(await api.put('/api/users/' + absentId).send({}), '/api/users/{uid}', 'put', 'VALIDATION_ERROR', 'Actualización vacía');
    expect(f.calls).to.deep.equal([]);
  });
  it('no admite arreglos privados en altas ni actualizaciones', async () => {
    for (const field of ['documents', 'proofs']) {
      error(await api.post('/api/users').send({ ...userInput, [field]: [] }), '/api/users', 'post', 'VALIDATION_ERROR', 'Campo no permitido');
      error(await api.put('/api/users/' + absentId).send({ [field]: [] }), '/api/users/{uid}', 'put', 'VALIDATION_ERROR', 'Campo no permitido');
    }
    expect(f.calls).to.deep.equal([]);
  });
  for (const method of ['get', 'put', 'delete']) {
    it(method + ': distingue ID inválido de perfil ausente', async () => {
      const send = route => method === 'put' ? api[method](route).send({ firstName: 'Luz' }) : api[method](route);
      error(await send('/api/users/bad'), '/api/users/{uid}', method, 'INVALID_ID');
      expect(f.calls).to.deep.equal([]);
      error(await send('/api/users/' + absentId), '/api/users/{uid}', method, 'USER_NOT_FOUND');
    });
  }
  for (const [method, route, documented] of [['post', '/api/users', '/api/users'], ['put', '/api/users/' + absentId, '/api/users/{uid}']]) {
    it(method + ': parser rechaza JSON roto y cuerpo grande', async () => {
      error(await api[method](route).type('json').send('{"firstName":'), documented, method, 'INVALID_JSON');
      error(await api[method](route).send({ firstName: 'x'.repeat(110000) }), documented, method, 'PAYLOAD_TOO_LARGE');
      expect(f.calls).to.deep.equal([]);
    });
  }
  for (const [method, route, documented, fault, body] of [
    ['get', '/api/users', '/api/users', 'list'], ['post', '/api/users', '/api/users', 'create', userInput],
    ['get', '/api/users/' + absentId, '/api/users/{uid}', 'get'],
    ['put', '/api/users/' + absentId, '/api/users/{uid}', 'update', { firstName: 'Luz' }],
    ['delete', '/api/users/' + absentId, '/api/users/{uid}', 'remove'],
  ]) {
    it(method + ' ' + route + ': fallo de persistencia seguro', async () => {
      f.faults['users.' + fault] = privateFailure();
      const pending = api[method](route); if (body) pending.send(body);
      error(await pending, documented, method, 'DATABASE_ERROR');
    });
  }
});
