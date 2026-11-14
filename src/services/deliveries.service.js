const v = require('../utils/validation');
const { DELIVERY_STATUS } = require('../constants');
class DeliveriesService {
  constructor(repository) { this.repository = repository; }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'DELIVERY_NOT_FOUND'); }
  async list(query = {}) {
    v.fields(query, ['status', 'page', 'limit']);
    if (query.status !== undefined && !Object.values(DELIVERY_STATUS).includes(query.status)) v.invalid(undefined, 'INVALID_DELIVERY_STATUS');
    return this.repository.list({ ...v.pagination(query), status: query.status });
  }
}
module.exports = DeliveriesService;
