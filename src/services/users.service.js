const { USER_ROLES } = require('../constants');
const v = require('../utils/validation');
function validate(input, partial = false) {
  // Roles are chosen on creation only; privileged profiles are not accepted over HTTP.
  v.fields(input, partial ? ['firstName', 'lastName', 'email'] : ['firstName', 'lastName', 'email', 'role']);
  if (!partial && input.role !== undefined && !['user', 'driver'].includes(input.role)) v.invalid('Rol de perfil inválido');
  if (partial && !Object.keys(input).length) v.invalid('Actualización vacía');
  const data = {};
  for (const key of ['firstName', 'lastName', 'email']) if (!partial || key in input) data[key] = v.string(input[key], key);
  if (data.email !== undefined) {
    data.email = data.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) v.invalid('email inválido');
  }
  if (!partial) data.role = input.role || USER_ROLES.USER;
  return data;
}
class UsersService {
  constructor(repository, { ordersRepository, deliveriesRepository, withTransaction } = {}) { Object.assign(this, { repository, ordersRepository, deliveriesRepository, withTransaction }); }
  async list(input = {}) { v.fields(input, ['page', 'limit']); return this.repository.list(v.pagination(input)); }
  async addDocument(id, metadata) { return v.found(await this.repository.addDocument(v.id(id), metadata), 'USER_NOT_FOUND'); }
  hasDocument(id, filename) { return this.repository.hasDocument(v.id(id), filename); }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'USER_NOT_FOUND'); }
  async create(input) { return this.repository.create(validate(input)); }
  async update(id, input) { return v.found(await this.repository.update(v.id(id), validate(input, true)), 'USER_NOT_FOUND'); }
  async remove(id) {
    v.id(id);
    if (!this.withTransaction) return v.found(await this.repository.remove(id), 'USER_NOT_FOUND');
    return this.withTransaction(async session => {
      v.found(await this.repository.touch(id, session), 'USER_NOT_FOUND');
      if (await this.ordersRepository.byCustomer(id, session) || await this.deliveriesRepository.byDriver(id, session)) v.invalid(undefined, 'USER_IN_USE');
      return v.found(await this.repository.removeInSession(id, session), 'USER_NOT_FOUND');
    });
  }
}
module.exports = UsersService;
