import createApp from '../../src/app.js';
import helpers from '../../test/helpers/fixtures.js';
import mockFixtures from '../../test/helpers/mocks-fixtures.js';
import OrdersService from '../../src/services/orders.service.js';
import DeliveriesService from '../../src/services/deliveries.service.js';
import persistence from '../../src/repositories/persistence.js';

export const config = Object.freeze({ nodeEnv: 'test', timestamp: '2026-01-01T12:00:00.000Z' });
export const absentId = 'ffffffffffffffffffffffff';
export const userInput = Object.freeze({ firstName: 'Alex', lastName: 'Ejemplo', email: 'alex@example.test' });
export const orderInput = customer => ({ customer, items: [{ name: 'Aro ficticio', quantity: 2, price: 125.5 }], deliveryAddress: 'Calle Ficticia 100' });
export const batchInput = () => ({ users: 1, drivers: 1, orders: 1, deliveries: 1 });
export const privateFailure = () => new Error('mongodb://private:password@internal.example PRIVATE_TOKEN email@private.test');
export const duplicate = field => Object.assign(privateFailure(), { code: 11000, keyPattern: { [field]: 1 } });

export function fixture({ nodeEnv = config.nodeEnv, forbidden = false, uploadRoot, uploadIO } = {}) {
  const base = helpers.fixtures(), faults = {}, calls = [], logs = [];
  const orders = new Map(), deliveries = new Map(), documents = new Map(), proofs = new Map();
  let sequence = 100;
  const persisted = data => {
    const id = (sequence++).toString(16).padStart(24, '0');
    return { ...structuredClone(data), _id: id, id, createdAt: config.timestamp, updatedAt: config.timestamp };
  };
  const run = (name, work, options) => persistence.persist(async () => {
    calls.push(name);
    if (faults[name]) throw faults[name];
    return work();
  }, options);
  for (const [name, original] of Object.entries(base.usersRepository)) {
    base.usersRepository[name] = (...args) => run('users.' + name, async () => {
      const row = await original(...args);
      if (name === 'create' && row) Object.assign(row, { createdAt: config.timestamp, updatedAt: config.timestamp });
      return row;
    }, { entity: 'users' });
  }
  const repository = (name, rows) => ({
    get: id => run(name + '.get', () => rows.get(id)),
    create: data => run(name + '.create', () => { const row = persisted(data); rows.set(row.id, row); return row; }),
    list: ({ page, limit, status }) => run(name + '.list', () => {
      const all = [...rows.values()].filter(r => status === undefined || r.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const totalPages = Math.max(1, Math.ceil(all.length / limit));
      return { docs: all.slice((page - 1) * limit, page * limit), page, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages, prevPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null };
    }),
  });
  const ordersRepository = repository('orders', orders), deliveriesRepository = repository('deliveries', deliveries);
  base.usersRepository.addDocument = (id, metadata) => run('users.addDocument', async () => {
    if (!await base.usersRepository.get(id)) return null;
    const entries = documents.get(id) || []; entries.push(structuredClone(metadata)); documents.set(id, entries);
    return { _id: id };
  });
  base.usersRepository.hasDocument = (id, filename) => run('users.hasDocument', () => (documents.get(id) || []).some(d => d.filename === filename));
  deliveriesRepository.addProof = (id, metadata) => run('deliveries.addProof', () => {
    if (!deliveries.has(id)) return null;
    const entries = proofs.get(id) || []; entries.push(structuredClone(metadata)); proofs.set(id, entries);
    return { _id: id };
  });
  deliveriesRepository.hasProof = (id, filename) => run('deliveries.hasProof', () => (proofs.get(id) || []).some(d => d.filename === filename));
  const mocks = mockFixtures({ forbidden });
  for (const entity of ['users', 'orders', 'deliveries']) {
    const repo = mocks.dependencies[entity + 'Repository'], insert = repo.insertMany;
    repo.insertMany = async (...args) => {
      calls.push('mocks.' + entity);
      if (faults['mocks.' + entity]) throw faults['mocks.' + entity];
      return (await insert(...args)).map(row => ({ ...row, createdAt: config.timestamp, updatedAt: config.timestamp }));
    };
  }
  const transaction = mocks.dependencies.withTransaction;
  mocks.service.withTransaction = async work => {
    if (faults.transaction) throw faults.transaction;
    return transaction(work);
  };
  const logger = { log: (level, message, meta) => logs.push({ level, message, ...meta }) };
  const app = createApp({ ...base, ordersService: new OrdersService(ordersRepository, base.usersRepository), deliveriesService: new DeliveriesService(deliveriesRepository), mocksService: mocks.service, nodeEnv, logger, uploadRoot, uploadIO });
  return {
    app, faults, calls, logs, orders, deliveries, documents, proofs, mocks, deliveriesRepository, ...base,
    seedOrder(data = {}) { const row = persisted({ ...orderInput('000000000000000000000001'), total: 251, priority: 'normal', status: 'created', ...data }); orders.set(row.id, row); return row; },
    seedDelivery(data = {}) { const row = persisted({ order: '000000000000000000000002', status: 'pending', ...data }); deliveries.set(row.id, row); return row; },
    dispose() { orders.clear(); deliveries.clear(); documents.clear(); proofs.clear(); calls.length = 0; logs.length = 0; mocks.batches.length = 0; for (const key of Object.keys(faults)) delete faults[key]; },
  };
}
