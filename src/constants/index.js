const USER_ROLES = Object.freeze({ ADMIN: 'admin', USER: 'user', DRIVER: 'driver' });
const PRODUCT_STATUS = Object.freeze({ AVAILABLE: 'available', OUT_OF_STOCK: 'out_of_stock', INACTIVE: 'inactive' });
const ORDER_STATUS = Object.freeze({
  CREATED: 'created', ASSIGNED: 'assigned', PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit', DELIVERED: 'delivered', CANCELLED: 'cancelled',
});
const DELIVERY_STATUS = Object.freeze({ PENDING: 'pending', ASSIGNED: 'assigned' });
const DELIVERY_PRIORITY = Object.freeze({ LOW: 'low', NORMAL: 'normal', HIGH: 'high' });
module.exports = Object.freeze({ USER_ROLES, PRODUCT_STATUS, ORDER_STATUS, DELIVERY_STATUS, DELIVERY_PRIORITY });
