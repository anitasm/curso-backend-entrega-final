const { Router } = require('express');
const controller = require('../controllers/orders.controller');
module.exports = service => {
  const router = Router();
  const c = controller(service);
  router.get('/', c.list);
  router.get('/:oid', c.get);
  return router;
};
