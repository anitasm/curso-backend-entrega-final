const http = require('node:http');
const { Server } = require('socket.io');
const { loadConfig } = require('./config/env.config');
const { connectDB, disconnectDB } = require('./config/db');
const createApp = require('./app');
const { registerProductSocket } = require('./sockets/products');
const { createLogger } = require('./utils/logger');
const { logEvent, startupCodes } = require('./utils/log-events');
async function startServer({ loggerFactory = createLogger } = {}) {
  let server, io, logger;
  let connectionAttempted = false;
  let stage = 'server.config_failed';
  let closing;
  const onSignal = () => { void close(); };
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      try {
        if (io) await new Promise(resolve => io.close(resolve));
        else if (server?.listening) await new Promise(resolve => server.close(resolve));
      } catch { logEvent('warning', 'server.cleanup_failed', {}, logger); }
      try { if (connectionAttempted) await disconnectDB(); }
      catch { logEvent('warning', 'server.cleanup_failed', {}, logger); }
      await logger?.shutdown?.();
    })();
    return closing;
  }
  try {
    const config = loadConfig();
    logger = loggerFactory({ nodeEnv: config.nodeEnv });
    stage = 'server.prepare_failed';
    const ProductsRepository = require('./repositories/products.repository');
    const UsersRepository = require('./repositories/users.repository');
    const CartsRepository = require('./repositories/carts.repository');
    const ProductsService = require('./services/products.service');
    const UsersService = require('./services/users.service');
    const CartsService = require('./services/carts.service');
    const OrdersRepository = require('./repositories/orders.repository');
    const OrdersService = require('./services/orders.service');
    const ordersRepository = new OrdersRepository();
    const ordersService = new OrdersService(ordersRepository);
    const productsService = new ProductsService(new ProductsRepository());
    const usersService = new UsersService(new UsersRepository());
    const cartsService = new CartsService(new CartsRepository(), productsService);
    stage = 'server.database_failed';
    connectionAttempted = true;
    await connectDB(config.mongoUri);
    logEvent('info', 'database.connected', { nodeEnv: config.nodeEnv }, logger);
    stage = 'server.prepare_failed';
    await Promise.all([new ProductsRepository().initialize(), new UsersRepository().initialize()]);
    let mocksService;
    if (['development', 'test'].includes(config.nodeEnv)) {
      const DeliveriesRepository = require('./repositories/deliveries.repository');
      const MocksService = require('./services/mocks.service');
      const createMockPersistence = require('./repositories/mock-transaction');
      const deliveriesRepository = new DeliveriesRepository();
      await Promise.all([ordersRepository.initialize(), deliveriesRepository.initialize()]);
      mocksService = new MocksService({
        usersRepository: new UsersRepository(), ordersRepository, deliveriesRepository,
        ...createMockPersistence(), logger,
      });
    }
    const app = createApp({ productsService, usersService, cartsService, mocksService, ordersService, nodeEnv: config.nodeEnv, logger });
    server = http.createServer(app);
    io = new Server(server);
    app.set('io', io);
    registerProductSocket(io, productsService, logger);
    stage = 'server.listen_failed';
    await new Promise((resolve, reject) => {
      const failed = error => { server.removeListener('listening', ready); reject(error); };
      const ready = () => { server.removeListener('error', failed); resolve(); };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen(config.port);
    });
    server.on('error', () => {
      if (closing) return;
      process.exitCode = 1;
      logEvent('fatal', 'server.failed', { code: startupCodes['server.failed'] }, logger);
      void close();
    });
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    logEvent('info', 'server.started', { port: config.port, nodeEnv: config.nodeEnv }, logger);
    return { app, server, io, logger, close };
  } catch (error) {
    process.exitCode = 1;
    // Invalid configuration cannot choose the logging policy or leak input values.
    if (!logger) logger = loggerFactory({ nodeEnv: 'production' });
    const event = stage === 'server.listen_failed' && error.code === 'EADDRINUSE' ? 'server.port_in_use' : stage;
    logEvent('fatal', event, { code: startupCodes[event] }, logger);
    await close();
  }
}
if (require.main === module) void startServer();
module.exports = { startServer };
