const { Router } = require('express');
const controller = require('../controllers/deliveries.controller');
module.exports = service => {
  const router = Router();
  const c = controller(service);
  router.get('/', c.list);
  router.get('/:did', c.get);
  return router;
};
