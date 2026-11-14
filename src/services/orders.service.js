const v = require('../utils/validation');
const { ORDER_STATUS, DELIVERY_PRIORITY, USER_ROLES } = require('../constants');
const { logEvent } = require('../utils/log-events');

function validate(input) {
  v.fields(input, ['customer', 'items', 'deliveryAddress', 'priority']);
  const customer = v.id(input.customer);
  if (!Array.isArray(input.items) || !input.items.length) v.invalid('items debe ser un arreglo no vacío');
  const items = input.items.map(item => {
    v.fields(item, ['name', 'quantity', 'price']);
    const name = v.string(item.name, 'name');
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) v.invalid('quantity debe ser un entero seguro positivo');
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) v.invalid('price debe ser un número finito no negativo');
    return { name, quantity: item.quantity, price: item.price };
  });
  const deliveryAddress = v.string(input.deliveryAddress, 'deliveryAddress');
  const priority = input.priority === undefined ? DELIVERY_PRIORITY.NORMAL : input.priority;
  if (!Object.values(DELIVERY_PRIORITY).includes(priority)) v.invalid('Prioridad de pedido inválida');
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  if (!Number.isFinite(total)) v.invalid('El total del pedido debe ser finito');
  return { customer, items, deliveryAddress, priority, total, status: ORDER_STATUS.CREATED };
}

class OrdersService {
  constructor(repository, usersRepository) { Object.assign(this, { repository, usersRepository }); }
  async create(input) {
    const data = validate(input);
    const customer = v.found(await this.usersRepository.get(data.customer), 'USER_NOT_FOUND');
    if (customer.role !== USER_ROLES.USER) v.invalid('El cliente debe tener rol user');
    const order = await this.repository.create(data);
    logEvent('info', 'order.created', { orders: 1 });
    return order;
  }
  async get(id) { return v.found(await this.repository.get(v.id(id)), 'ORDER_NOT_FOUND'); }
  async list(query = {}) {
    v.fields(query, ['status', 'page', 'limit']);
    if (query.status !== undefined && !Object.values(ORDER_STATUS).includes(query.status)) v.invalid(undefined, 'INVALID_ORDER_STATUS');
    return this.repository.list({ ...v.pagination(query), status: query.status });
  }
}
module.exports = OrdersService;
