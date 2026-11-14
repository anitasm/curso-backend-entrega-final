const path = require('node:path');
let specification;
module.exports = function getSpecification() {
  if (!specification) {
    const swaggerJsdoc = require('swagger-jsdoc');
    specification = swaggerJsdoc({
      failOnErrors: true,
      definition: {
        openapi: '3.0.3',
        info: {
          title: 'ShipNow / Rina API', version: require('../../package.json').version,
          description: 'Catálogo y perfiles, consultas de pedidos y entregas, y generación de datos ficticios. No realiza pagos ni envíos reales. Mocks y Logger responden 404 ROUTE_NOT_FOUND en producción. Try it out ejecuta operaciones reales; cada POST de mocks agrega documentos en shipnow_mock_dev.',
        },
        servers: [{ url: '/', description: 'Mismo origen y puerto que esta documentación (ejemplo local: http://localhost:8080).' }],
        tags: ['Users', 'Orders', 'Deliveries', 'Mocks', 'Logger', 'Health'].map(name => ({ name })),
        components: require('./components'),
      },
      apis: [path.join(__dirname, 'paths', '*.yaml').replace(/\\/g, '/')],
    });
  }
  return specification;
};
