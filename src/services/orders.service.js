const v = require('../utils/validation');
const { ORDER_STATUS } = require('../constants');
class OrdersService {
  constructor(repository) { this.repository = repository; }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'ORDER_NOT_FOUND'); }
  async list(query = {}) {
    v.fields(query, ['status', 'page', 'limit']);
    if (query.status !== undefined && !Object.values(ORDER_STATUS).includes(query.status)) v.invalid(undefined, 'INVALID_ORDER_STATUS');
    return this.repository.list({ ...v.pagination(query), status: query.status });
  }
}
module.exports = OrdersService;
