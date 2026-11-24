const v = require('../utils/validation');
const AppError = require('../errors/AppError');
const { DELIVERY_STATUS } = require('../constants');
const { logEvent } = require('../utils/log-events');
class DeliveriesService {
  constructor(repository, { ordersService, usersRepository, withTransaction = work => work() } = {}) { Object.assign(this, { repository, ordersService, usersRepository, withTransaction }); }
  async driver(id, session) {
    const profile = v.found(await this.usersRepository.touch(id, session), 'USER_NOT_FOUND');
    if (profile.role !== 'driver') throw new AppError('INVALID_DRIVER_ROLE');
  }
  async create(input) {
    v.fields(input, ['order', 'driver']); const orderId = v.id(input.order);
    const driver = input.driver === undefined ? undefined : v.id(input.driver);
    const row = await this.withTransaction(async session => {
      const order = await this.ordersService.state(orderId, session);
      if (await this.repository.byOrder(orderId, session)) throw new AppError('DELIVERY_ALREADY_EXISTS');
      if (order.status !== 'created') throw new AppError('INVALID_DELIVERY_ASSIGNMENT');
      if (driver) await this.driver(driver, session);
      await this.ordersService.change(order, driver ? { status: 'assigned' } : {}, driver ? { status: 'assigned', timestamp: new Date(), source: 'actual' } : null, session);
      return this.repository.create({ order: orderId, ...(driver ? { driver } : {}), status: driver ? 'assigned' : 'pending' }, session);
    });
    logEvent('info', 'delivery.created'); return row;
  }
  async assign(id, input) {
    v.id(id); v.fields(input, ['driver']); const driver = v.id(input.driver);
    const row = await this.withTransaction(async session => {
      const delivery = v.found(await this.repository.state(id, session), 'DELIVERY_NOT_FOUND');
      const order = await this.ordersService.state(String(delivery.order), session);
      if (delivery.status !== 'pending' || order.status !== 'created') throw new AppError('INVALID_DELIVERY_ASSIGNMENT');
      await this.driver(driver, session);
      await this.ordersService.change(order, { status: 'assigned' }, { status: 'assigned', timestamp: new Date(), source: 'actual' }, session);
      return v.found(await this.repository.assign(id, driver, session), 'INVALID_DELIVERY_ASSIGNMENT');
    });
    logEvent('info', 'delivery.assigned'); return row;
  }
  async addProof(id, metadata) { return v.found(await this.repository.addProof(v.id(id), metadata), 'DELIVERY_NOT_FOUND'); }
  hasProof(id, filename) { return this.repository.hasProof(v.id(id), filename); }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'DELIVERY_NOT_FOUND'); }
  async list(query = {}) {
    v.fields(query, ['status', 'page', 'limit']);
    if (query.status !== undefined && !Object.values(DELIVERY_STATUS).includes(query.status)) v.invalid(undefined, 'INVALID_DELIVERY_STATUS');
    return this.repository.list({ ...v.pagination(query), status: query.status });
  }
}
module.exports = DeliveriesService;
