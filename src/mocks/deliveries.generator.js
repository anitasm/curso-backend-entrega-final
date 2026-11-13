const { DELIVERY_STATUS } = require('../constants');

function generateDeliveries(quantity, { orderIds, driverIds = [] }) {
  return Array.from({ length: quantity }, (_, index) => ({
    order: orderIds[index],
    ...(driverIds.length ? { driver: driverIds[index % driverIds.length] } : {}),
    status: driverIds.length ? DELIVERY_STATUS.ASSIGNED : DELIVERY_STATUS.PENDING,
  }));
}

module.exports = generateDeliveries;
