const { Router } = require('express');
const controller = require('../controllers/mocks.controller');

module.exports = service => {
  const router = Router();
  const c = controller(service);
  router.get('/users', c.users);
  router.get('/mockingusers', c.mockingUsers);
  router.get('/mockingdrivers', c.mockingDrivers);
  router.get('/mockingorders', c.mockingOrders);
  router.get('/mockingdeliveries', c.mockingDeliveries);
  router.post('/seed', c.seed);
  router.post('/generateData', c.generateData);
  return router;
};
