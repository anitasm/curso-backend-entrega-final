const { Router } = require('express');
const { logEvent } = require('../utils/log-events');
module.exports = () => {
  const router = Router();
  router.get('/', (_req, res) => {
    for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) {
      logEvent(level, 'logger.test', { synthetic: true });
    }
    res.json({ status: 'success', message: 'Logs de diagnóstico generados' });
  });
  return router;
};
