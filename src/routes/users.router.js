const { Router } = require('express');
const controller = require('../controllers/users.controller');
module.exports = (service, receive) => {
  const router = Router();
  const c = controller(service, receive);
  router.get('/', c.list);
  router.post('/:uid/documents', c.upload);
  router.get('/:uid', c.get);
  router.post('/', c.create);
  router.put('/:uid', c.update);
  router.delete('/:uid', c.remove);
  return router;
};
