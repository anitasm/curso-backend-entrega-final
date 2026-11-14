const express = require('express');
const path = require('node:path');
const httpLogger = require('./middlewares/http-logger');
const { engine } = require('express-handlebars');
const errors = require('./middlewares/errors');
const AppError = require('./errors/AppError');
function createApp({ productsService, usersService, cartsService, mocksService, ordersService, nodeEnv, upload, io, logger } = {}) {
  const app = express();
  app.engine('handlebars', engine());
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, 'views'));
  app.use(httpLogger(logger));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  if (io) app.set('io', io);
  if (ordersService) app.use('/api/orders', require('./routes/orders.router')(ordersService));
  if (['development', 'test'].includes(nodeEnv)) app.use('/loggerTest', require('./routes/logger.router')());
  app.use('/api/health', require('./routes/health.router'));
  app.use('/api/products', require('./routes/products.router')(productsService, upload));
  app.use('/api/users', require('./routes/users.router')(usersService));
  app.use('/api/carts', require('./routes/carts.router')(cartsService));
  if (mocksService && ['development', 'test'].includes(nodeEnv)) {
    app.use('/api/mocks', require('./routes/mocks.router')(mocksService));
  }
  app.use('/', require('./routes/views.router')(productsService, cartsService));
  app.use((_req, _res, next) => next(new AppError('ROUTE_NOT_FOUND')));
  app.use(errors);
  app.use(errors.closePartial);
  return app;
}
module.exports = createApp;
