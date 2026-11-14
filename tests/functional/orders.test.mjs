import { expect } from 'chai';
import request from 'supertest';
import { fixture, userInput, orderInput, absentId, privateFailure, duplicate } from '../support/fixture.mjs';
import { response, error, page, persisted } from '../support/responses.mjs';

describe('Orders: alta, consultas y validación', () => {
  let f, api;
  beforeEach(() => { f = fixture(); api = request(f.app); });
  afterEach(() => { f.dispose(); f = api = null; });
  const customer = async () => (await api.post('/api/users').send(userInput)).body.payload;
  it('crea con total calculado, consulta por ID y filtra con paginación', async () => {
    const user = await customer(); const input = orderInput(user.id);
    input.items.push({ name: 'Pulsera', quantity: 3, price: 10 });
    const r = await api.post('/api/orders').send(input);
    const row = response(r, '/api/orders', 'post', 201).payload; persisted(row);
    expect(row).to.include({ customer: user.id, total: 281, status: 'created', priority: 'normal' });
    expect(f.orders.size).to.equal(1); expect(f.deliveries.size).to.equal(0);
    const events = f.logs.filter(l => l.event === 'order.created'); expect(events).to.have.length(1);
    expect(events[0]).to.include({ level: 'info', orders: 1, requestId: r.headers['x-request-id'] });
    expect(JSON.stringify(events)).not.to.include(input.deliveryAddress).and.not.to.include(user.email).and.not.to.include(user.id);
    const found = await api.get('/api/orders/' + row.id); expect(response(found, '/api/orders/{oid}', 'get', 200).payload).to.deep.equal(row);
    f.seedOrder({ status: 'assigned' }); f.seedOrder();
    const list = await api.get('/api/orders?status=created&page=1&limit=1'); page(response(list, '/api/orders', 'get', 200));
    expect(list.body.payload).to.have.length(1); expect(list.body.totalPages).to.equal(2);
    expect(list.body.nextLink).to.equal('/api/orders?status=created&page=2&limit=1');
    expect(list.body.prevLink).to.equal(null);
  });
  it('acepta precio cero y prioridad high con textos recortados', async () => {
    const user = await customer(); const input = orderInput(user.id);
    input.priority = 'high'; input.items = [{ name: ' Aro ', quantity: 1, price: 0 }]; input.deliveryAddress = ' Calle Ficticia 100 ';
    const row = response(await api.post('/api/orders').send(input), '/api/orders', 'post', 201).payload;
    expect(row).to.include({ total: 0, priority: 'high', deliveryAddress: 'Calle Ficticia 100' }); expect(row.items[0].name).to.equal('Aro');
  });
  it('retorna lista vacía con metadatos completos', async () => {
    const r = await api.get('/api/orders'); page(response(r, '/api/orders', 'get', 200));
    expect(r.body.payload).to.deep.equal([]); expect(r.body.totalPages).to.equal(1); expect(r.body.nextPage).to.equal(null);
  });
  const invalid = [
    ['cuerpo incompleto', () => ({}), 'INVALID_ID'],
    ['cliente mal formado', d => ({ ...d, customer: 'bad' }), 'INVALID_ID'],
    ['items vacío', d => ({ ...d, items: [] }), 'VALIDATION_ERROR', 'items debe ser un arreglo no vacío'],
    ['items no arreglo', d => ({ ...d, items: {} }), 'VALIDATION_ERROR', 'items debe ser un arreglo no vacío'],
    ['dirección vacía', d => ({ ...d, deliveryAddress: ' ' }), 'VALIDATION_ERROR', 'deliveryAddress debe ser texto no vacío'],
    ['prioridad inválida', d => ({ ...d, priority: 'urgent' }), 'VALIDATION_ERROR', 'Prioridad de pedido inválida'],
    ['prioridad null', d => ({ ...d, priority: null }), 'VALIDATION_ERROR', 'Prioridad de pedido inválida'],
    ['total escrito', d => ({ ...d, total: 1 }), 'VALIDATION_ERROR', 'Campo no permitido'],
    ['status escrito', d => ({ ...d, status: 'assigned' }), 'VALIDATION_ERROR', 'Campo no permitido'],
    ['id escrito', d => ({ ...d, _id: absentId }), 'VALIDATION_ERROR', 'Campo no permitido'],
    ['item con campo extra', d => ({ ...d, items: [{ ...d.items[0], extra: true }] }), 'VALIDATION_ERROR', 'Campo no permitido'],
    ['item null', d => ({ ...d, items: [null] }), 'VALIDATION_ERROR', 'Se requiere un objeto'],
    ['nombre vacío', d => ({ ...d, items: [{ ...d.items[0], name: ' ' }] }), 'VALIDATION_ERROR', 'name debe ser texto no vacío'],
    ...['2', 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, null].map(quantity => ['quantity ' + quantity, d => ({ ...d, items: [{ ...d.items[0], quantity }] }), 'VALIDATION_ERROR', 'quantity debe ser un entero seguro positivo']),
    ...['2', -1, null, true].map(price => ['price ' + price, d => ({ ...d, items: [{ ...d.items[0], price }] }), 'VALIDATION_ERROR', 'price debe ser un número finito no negativo']),
    ['desborde multiplicación', d => ({ ...d, items: [{ name: 'Aro', quantity: 2, price: Number.MAX_VALUE }] }), 'VALIDATION_ERROR', 'El total del pedido debe ser finito'],
    ['desborde suma', d => ({ ...d, items: [{ name: 'A', quantity: 1, price: Number.MAX_VALUE }, { name: 'B', quantity: 1, price: Number.MAX_VALUE }] }), 'VALIDATION_ERROR', 'El total del pedido debe ser finito'],
  ];
  for (const [name, change, code, message] of invalid) {
    it('rechaza ' + name + ' antes de leer usuarios o escribir', async () => {
      error(await api.post('/api/orders').send(change(orderInput(absentId))), '/api/orders', 'post', code, message);
      expect(f.calls).to.deep.equal([]); expect(f.orders.size).to.equal(0); expect(f.logs.some(l => l.event === 'order.created')).to.equal(false);
    });
  }
  it('rechaza JSON roto, tipo de contenido incorrecto y payload excesivo', async () => {
    error(await api.post('/api/orders').type('json').send('{"customer":'), '/api/orders', 'post', 'INVALID_JSON');
    error(await api.post('/api/orders').type('form').send(orderInput(absentId)), '/api/orders', 'post', 'VALIDATION_ERROR', 'El alta de pedidos requiere un body JSON');
    error(await api.post('/api/orders').send({ ...orderInput(absentId), deliveryAddress: 'x'.repeat(110000) }), '/api/orders', 'post', 'PAYLOAD_TOO_LARGE');
    expect(f.calls).to.deep.equal([]);
  });
  it('cliente válido ausente produce USER_NOT_FOUND sin insertar', async () => {
    error(await api.post('/api/orders').send(orderInput(absentId)), '/api/orders', 'post', 'USER_NOT_FOUND');
    expect(f.calls).to.deep.equal(['users.get']); expect(f.orders.size).to.equal(0);
  });
  it('rechaza números JSON fuera del rango finito antes de persistir', async () => {
    const raw = '{"customer":"' + absentId + '","items":[{"name":"Aro","quantity":1,"price":1e400}],"deliveryAddress":"Calle Ficticia 100"}';
    error(await api.post('/api/orders').type('json').send(raw), '/api/orders', 'post', 'VALIDATION_ERROR', 'price debe ser un número finito no negativo');
    expect(f.calls).to.deep.equal([]);
  });
  for (const role of ['driver', 'admin']) it('rechaza perfil con rol ' + role, async () => {
    const user = await f.usersRepository.create({ ...userInput, role }); f.calls.length = 0;
    error(await api.post('/api/orders').send(orderInput(user.id)), '/api/orders', 'post', 'VALIDATION_ERROR', 'El cliente debe tener rol user');
    expect(f.calls).to.deep.equal(['users.get']);
  });
  for (const fault of ['users.get', 'orders.create']) it('alta maneja fallo de ' + fault + ' sin log de éxito', async () => {
    const user = await customer(); f.faults[fault] = privateFailure();
    error(await api.post('/api/orders').send(orderInput(user.id)), '/api/orders', 'post', 'DATABASE_ERROR');
    expect(f.orders.size).to.equal(0); expect(f.logs.some(l => l.event === 'order.created')).to.equal(false);
  });
  it('propaga conflicto de inserción como DUPLICATE_KEY', async () => {
    const user = await customer(); f.faults['orders.create'] = duplicate('_id');
    error(await api.post('/api/orders').send(orderInput(user.id)), '/api/orders', 'post', 'DUPLICATE_KEY');
  });
  it('valida filtros antes de consultar y distingue ID inválido de ausente', async () => {
    error(await api.get('/api/orders?status=bad'), '/api/orders', 'get', 'INVALID_ORDER_STATUS');
    error(await api.get('/api/orders?limit=101'), '/api/orders', 'get', 'VALIDATION_ERROR', 'limit no puede superar 100');
    error(await api.get('/api/orders/bad'), '/api/orders/{oid}', 'get', 'INVALID_ID');
    expect(f.calls).to.deep.equal([]);
    error(await api.get('/api/orders/' + absentId), '/api/orders/{oid}', 'get', 'ORDER_NOT_FOUND');
  });
  for (const [route, doc, name] of [['/api/orders', '/api/orders', 'list'], ['/api/orders/' + absentId, '/api/orders/{oid}', 'get']]) it('consulta ' + name + ' protege errores internos', async () => {
    f.faults['orders.' + name] = privateFailure(); error(await api.get(route), doc, 'get', 'DATABASE_ERROR');
  });
});
