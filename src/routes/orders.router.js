const { Router } = require('express');
const controller = require('../controllers/orders.controller');
module.exports = service => {
  const router = Router();
  const c = controller(service);
  router.get('/', c.list);
  router.post('/', c.create);
  router.get('/:oid', c.get);
  router.put('/:oid', c.update);
  router.delete('/:oid', c.remove);
  router.patch('/:oid/status', c.transition);
  router.get('/:oid/tracking', c.tracking);
  return router;
};
