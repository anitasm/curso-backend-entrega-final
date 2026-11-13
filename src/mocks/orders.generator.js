const { ORDER_STATUS, DELIVERY_PRIORITY } = require('../constants');

const accessories = ['Aro de prueba Rina', 'Pulsera de prueba Rina', 'Collar de prueba Rina'];
const priorities = Object.values(DELIVERY_PRIORITY);

function generateOrders(quantity, { customerIds, assignedCount = 0 }) {
  return Array.from({ length: quantity }, (_, index) => {
    const items = [{ name: accessories[index % accessories.length], quantity: 1 + index % 3, price: 100 + index % 5 * 50 }];
    return {
      customer: customerIds[index % customerIds.length],
      items,
      total: items.reduce((sum, item) => sum + item.quantity * item.price, 0),
      deliveryAddress: `Calle Ficticia ${100 + index}, Ciudad de Prueba`,
      status: index < assignedCount ? ORDER_STATUS.ASSIGNED : ORDER_STATUS.CREATED,
      priority: priorities[index % priorities.length],
    };
  });
}

module.exports = generateOrders;
