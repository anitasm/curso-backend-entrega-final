const { test } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../src/models/Order');
const Repository = require('../src/repositories/orders.repository');

test('Pedidos: repositorio proyecta campos, filtra y pagina en orden estable', async t => {
  const captured = {};
  const id = '1234567890abcdef12345678';
  const chain = {
    select(value) { captured.select = value; return this; },
    sort(value) { captured.sort = value; return this; },
    skip(value) { captured.skip = value; return this; },
    limit(value) { captured.limit = value; return this; },
    async lean() { return [{ _id: id, status: 'assigned' }]; },
  };
  t.mock.method(Order, 'find', filter => { captured.filter = filter; return chain; });
  t.mock.method(Order, 'countDocuments', async filter => { assert.deepEqual(filter, captured.filter); return 11; });
  const repository = new Repository();
  const result = await repository.list({ page: 2, limit: 5, status: 'assigned' });
  assert.deepEqual(captured.filter, { status: 'assigned' });
  assert.deepEqual(captured.sort, { createdAt: -1, _id: 1 });
  assert.equal(captured.skip, 5);
  assert.equal(captured.limit, 5);
  assert.match(captured.select, /customer items/);
  assert.equal(result.docs[0].id, id);
  assert.equal(result.totalPages, 3);
  assert.equal(result.nextPage, 3);
  await repository.list({ page: 1, limit: 10 });
  assert.deepEqual(captured.filter, {});
  t.mock.method(Order, 'findById', value => { assert.equal(value, id); return { select: () => ({ lean: async () => null }) }; });
  assert.equal(await repository.get(id), null);
});
