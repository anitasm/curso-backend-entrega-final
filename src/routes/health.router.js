const { Router } = require('express');
const health = require('../controllers/health.controller');
module.exports = (nodeEnv = 'development') => {
  const router = Router();
  router.get('/', health(nodeEnv));
  return router;
};
