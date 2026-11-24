const { Router } = require('express');
const controller = require('../controllers/deliveries.controller');
module.exports = (service, receive) => {
  const router = Router();
  const c = controller(service, receive);
  router.get('/', c.list);
  router.post('/:did/proof', c.upload);
  router.get('/:did', c.get);
  router.post('/', c.create);
  router.patch('/:did/driver', c.assign);
  return router;
};
