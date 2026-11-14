const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const Delivery = require('../src/models/Delivery');
const UsersRepository = require('../src/repositories/users.repository');
const DeliveriesRepository = require('../src/repositories/deliveries.repository');
const id = '000000000000000000000001';
const metadata = { originalName: 'ficticio.pdf', filename: '00000000-0000-4000-8000-000000000001.pdf', path: 'uploads/documents/00000000-0000-4000-8000-000000000001.pdf', mimeType: 'application/pdf', size: 40, type: 'user_document', uploadedAt: new Date('2026-01-01') };
for (const [Model, Repository, field, add, has, data] of [
  [User, UsersRepository, 'documents', 'addDocument', 'hasDocument', { firstName: 'Alex', lastName: 'Ficticio', email: 'alex@example.test' }],
  [Delivery, DeliveriesRepository, 'proofs', 'addProof', 'hasProof', { order: id, status: 'pending' }],
]) {
  test(Model.modelName + ': push atómico con validadores, sin upsert y confirmación por filename', async t => {
    const repo = new Repository(); let returned = { _id: id };
    t.mock.method(Model, 'findByIdAndUpdate', (value, update, options) => {
      assert.equal(value, id); assert.deepEqual(update, { $push: { [field]: metadata } });
      assert.deepEqual(options, { new: true, runValidators: true, upsert: false });
      return { select(value) { assert.equal(value, '_id'); return { lean: async () => returned }; } };
    });
    assert.deepEqual(await repo[add](id, metadata), returned);
    returned = null; assert.equal(await repo[add](id, metadata), null);
    t.mock.method(Model, 'exists', async filter => { assert.deepEqual(filter, { _id: id, [field + '.filename']: metadata.filename }); return returned; });
    assert.equal(await repo[has](id, metadata.filename), false);
    returned = { _id: id }; assert.equal(await repo[has](id, metadata.filename), true);
  });
  test(Model.modelName + ': esquema compatible y metadatos excluidos de altas y lotes públicos', async t => {
    const old = new Model(data); assert.equal(old[field], undefined); await old.validate();
    assert.equal(Model.schema.path(field).options.select, false);
    const doc = new Model({ ...data, [field]: [metadata] }); await doc.validate();
    assert.equal(doc[field][0]._id, undefined);
    doc[field][0].size = 5242881; await assert.rejects(doc.validate()); doc[field][0].size = 5242880; await doc.validate();
    const repo = new Repository();
    t.mock.method(Model, 'insertMany', async () => [doc]);
    const rows = await repo.insertMany([data]); assert.equal(Object.hasOwn(rows[0], field), false);
    if (Model === User) { t.mock.method(Model, 'create', async () => doc); assert.equal(Object.hasOwn(await repo.create(data), field), false); }
  });
}
