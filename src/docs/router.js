const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const getSpecification = require('./index');
module.exports = () => {
  const router = Router();
  const spec = getSpecification();
  const options = { customSiteTitle: 'ShipNow / Rina API', swaggerOptions: { url: '/api/docs/openapi.json', validatorUrl: null } };
  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use(swaggerUi.serveFiles(undefined, options));
  router.get('/', swaggerUi.setup(undefined, options));
  return router;
};
