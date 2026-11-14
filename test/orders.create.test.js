const { test } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../src/models/Order');
const Repository = require('../src/repositories/orders.repository');
const Service = require('../src/services/orders.service');
const id = '000000000000000000000001';
const input = () => ({ customer: id, items: [{ name: 'Aro', quantity: 2, price: 125.5 }], deliveryAddress: 'Calle Ficticia 100' });

test('Alta de pedido: repositorio usa el modelo, conserva timestamps y normaliza IDs', async t => {
  let received;
  const now = new Date('2026-01-01T00:00:00Z');
  t.mock.method(Order, 'create', async data => {
    received = data;
    const document = new Order({ ...data, _id: id, createdAt: now, updatedAt: now });
    await document.validate();
    return document;
  });
  const data = { ...input(), total: 251, status: 'created', priority: 'normal' };
  const row = await new Repository().create(data);
  assert.deepEqual(received, data);
  assert.equal(row._id, id); assert.equal(row.id, id);
  assert.equal(row.createdAt.toISOString(), now.toISOString()); assert.equal(row.updatedAt.toISOString(), now.toISOString());
  assert.equal(row.total, 251); assert.equal(row.status, 'created');
  assert.equal(String(row.customer), id); assert.equal(row.items[0].quantity, 2);
});

test('Alta de pedido: fallo real del adaptador se traduce sin perder el contrato público', async t => {
  for (const [failure, code] of [[new Error('detalle privado'), 'DATABASE_ERROR'], [Object.assign(new Error('privado'), { code: 11000 }), 'DUPLICATE_KEY'], [Object.assign(new Error('privado'), { name: 'ValidationError' }), 'VALIDATION_ERROR']]) {
    t.mock.method(Order, 'create', async () => { throw failure; });
    await assert.rejects(new Repository().create(input()), error => error.code === code && error.cause === failure);
    t.mock.restoreAll();
  }
});

test('Alta de pedido: NaN e Infinity nunca llegan a la lectura del cliente', async () => {
  const service = new Service({ create: async () => assert.fail('No debe escribir') }, { get: async () => assert.fail('No debe leer') });
  for (const price of [NaN, Infinity, -Infinity]) await assert.rejects(service.create({ ...input(), items: [{ name: 'Aro', quantity: 1, price }] }), { code: 'VALIDATION_ERROR' });
});
