const v = require('../utils/validation');
const AppError = require('../errors/AppError');
const { ORDER_STATUS: S, DELIVERY_PRIORITY, USER_ROLES } = require('../constants');
const { MAX_ORDER_ITEMS, TRANSITIONS } = require('../config/orders.config');
const { logEvent } = require('../utils/log-events');
function validate(input, partial = false) {
  v.fields(input, partial ? ['items', 'deliveryAddress', 'priority'] : ['customer', 'items', 'deliveryAddress', 'priority']);
  if (partial && !Object.keys(input).length) v.invalid('Actualización vacía');
  const data = {};
  if (!partial) data.customer = v.id(input.customer);
  if (!partial || 'items' in input) {
    if (!Array.isArray(input.items) || !input.items.length) v.invalid('items debe ser un arreglo no vacío');
    if (input.items.length > MAX_ORDER_ITEMS) v.invalid('items no puede superar ' + MAX_ORDER_ITEMS);
    data.items = input.items.map(item => {
      v.fields(item, ['name', 'quantity', 'price']);
      const name = v.string(item.name, 'name');
      if (name.length > 200) v.invalid('name no puede superar 200 caracteres');
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) v.invalid('quantity debe ser un entero seguro positivo');
      if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) v.invalid('price debe ser un número finito no negativo');
      return { name, quantity: item.quantity, price: item.price };
    });
    data.total = data.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    if (!Number.isFinite(data.total)) v.invalid('El total del pedido debe ser finito');
  }
  if (!partial || 'deliveryAddress' in input) {
    data.deliveryAddress = v.string(input.deliveryAddress, 'deliveryAddress');
    if (data.deliveryAddress.length > 500) v.invalid('deliveryAddress no puede superar 500 caracteres');
  }
  if (!partial || 'priority' in input) {
    data.priority = input.priority === undefined ? DELIVERY_PRIORITY.NORMAL : input.priority;
    if (!Object.values(DELIVERY_PRIORITY).includes(data.priority)) v.invalid('Prioridad de pedido inválida');
  }
  if (!partial) data.status = S.CREATED;
  return data;
}
class OrdersService {
  constructor(repository, usersRepository, { deliveriesRepository, withTransaction = work => work() } = {}) { Object.assign(this, { repository, usersRepository, deliveriesRepository, withTransaction }); }
  async create(input) {
    const data = validate(input);
    const order = await this.withTransaction(async session => {
      const customer = v.found(await (session ? this.usersRepository.touch(data.customer, session) : this.usersRepository.get(data.customer)), 'USER_NOT_FOUND');
      if (customer.role !== USER_ROLES.USER) v.invalid('El cliente debe tener rol user');
      return this.repository.create(data, session);
    });
    logEvent('info', 'order.created', { orders: 1 }); return order;
  }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'ORDER_NOT_FOUND'); }
  async list(query = {}) {
    v.fields(query, ['status', 'page', 'limit']);
    if (query.status !== undefined && !Object.values(S).includes(query.status)) v.invalid(undefined, 'INVALID_ORDER_STATUS');
    return this.repository.list({ ...v.pagination(query), status: query.status });
  }
  async state(id, session) { return v.found(await this.repository.state(id, session), 'ORDER_NOT_FOUND'); }
  async change(state, data, event, session) { return v.found(await this.repository.change(state, data, event, session), 'ORDER_CONCURRENT_MODIFICATION'); }
  async update(id, input) {
    v.id(id); const data = validate(input, true);
    const result = await this.withTransaction(async session => {
      const state = await this.state(id, session);
      if (state.status !== S.CREATED) throw new AppError('ORDER_NOT_EDITABLE');
      return this.change(state, data, null, session);
    });
    logEvent('info', 'order.updated'); return result;
  }
  async remove(id) {
    v.id(id);
    await this.withTransaction(async session => {
      const state = await this.state(id, session);
      if (state.status !== S.CREATED || await this.deliveriesRepository.byOrder(id, session)) throw new AppError('ORDER_NOT_DELETABLE');
      await this.change(state, { deletedAt: new Date() }, null, session);
    });
    logEvent('info', 'order.deleted'); return { id, deleted: true };
  }
  async transition(id, input) {
    v.id(id); v.fields(input, ['status']);
    if (!Object.values(S).includes(input.status)) throw new AppError('INVALID_ORDER_STATUS');
    const result = await this.withTransaction(async session => {
      const state = await this.state(id, session);
      if (state.status === input.status) return { changed: false, row: await this.repository.get(id, session) };
      if (!TRANSITIONS[state.status]?.includes(input.status)) throw new AppError('INVALID_ORDER_TRANSITION');
      if (input.status === S.ASSIGNED) {
        const delivery = await this.deliveriesRepository.byOrder(id, session);
        if (!delivery?.driver || delivery.status !== 'assigned') throw new AppError('INVALID_ORDER_TRANSITION');
        const driver = v.found(await this.usersRepository.touch(String(delivery.driver), session), 'USER_NOT_FOUND');
        if (driver.role !== USER_ROLES.DRIVER) throw new AppError('INVALID_DRIVER_ROLE');
      }
      return { changed: true, row: await this.change(state, { status: input.status }, { status: input.status, timestamp: new Date(), source: 'actual' }, session) };
    });
    if (result.changed) logEvent('info', 'order.status_changed');
    return result.row;
  }
  async tracking(id) {
    const state = await this.state(v.id(id));
    return { orderId: String(state._id), status: state.status, historyComplete: Boolean(state.historyComplete), history: (state.history || []).map(event => ({ status: event.status, timestamp: event.timestamp, ...(event.source ? { source: event.source } : {}) })) };
  }
}
module.exports = OrdersService;
