const http = require('node:http');
const { Server } = require('socket.io');
const { loadConfig } = require('./config/env.config');
const { connectDB, disconnectDB } = require('./config/db');
const createApp = require('./app');
const { registerProductSocket } = require('./sockets/products');
const { createLogger } = require('./utils/logger');
const { logEvent, startupCodes } = require('./utils/log-events');
async function startServer({ loggerFactory = createLogger, shutdownTimeoutMs } = {}) {
  let server, io, logger;
  let connectionAttempted = false;
  let stage = 'server.config_failed';
  let closing = false, drainSockets;
  const onSignal = () => { void close().catch(() => { process.exitCode = 1; }); };
  const shutdown = require('./utils/shutdown')({
    resources: () => ({ server, io, logger, drainSockets, disconnect: () => connectionAttempted ? disconnectDB() : undefined }),
    onStart: () => { closing = true; },
    removeListeners: () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    },
    timeoutMs: shutdownTimeoutMs,
  });
  const close = () => shutdown();
  try {
    const config = loadConfig();
    logger = loggerFactory({ nodeEnv: config.nodeEnv, logLevel: config.logLevel });
    stage = 'server.prepare_failed';
    const ProductsRepository = require('./repositories/products.repository');
    const UsersRepository = require('./repositories/users.repository');
    const CartsRepository = require('./repositories/carts.repository');
    const ProductsService = require('./services/products.service');
    const UsersService = require('./services/users.service');
    const CartsService = require('./services/carts.service');
    const OrdersRepository = require('./repositories/orders.repository');
    const OrdersService = require('./services/orders.service');
    const DeliveriesRepository = require('./repositories/deliveries.repository');
    const DeliveriesService = require('./services/deliveries.service');
    const deliveriesRepository = new DeliveriesRepository();
    const deliveriesService = new DeliveriesService(deliveriesRepository);
    const ordersRepository = new OrdersRepository();
    const usersRepository = new UsersRepository();
    const ordersService = new OrdersService(ordersRepository, usersRepository);
    const productsService = new ProductsService(new ProductsRepository());
    const usersService = new UsersService(usersRepository);
    const cartsService = new CartsService(new CartsRepository(), productsService);
    stage = 'server.database_failed';
    connectionAttempted = true;
    await connectDB(config.mongoUri);
    logEvent('info', 'database.connected', { nodeEnv: config.nodeEnv }, logger);
    stage = 'server.prepare_failed';
    await Promise.all([new ProductsRepository().initialize(), usersRepository.initialize()]);
    let mocksService;
    if (['development', 'test'].includes(config.nodeEnv)) {
      const MocksService = require('./services/mocks.service');
      const createMockPersistence = require('./repositories/mock-transaction');
      await Promise.all([ordersRepository.initialize(), deliveriesRepository.initialize()]);
      mocksService = new MocksService({
        usersRepository, ordersRepository, deliveriesRepository,
        ...createMockPersistence(), logger,
      });
    }
    const app = createApp({ productsService, usersService, cartsService, mocksService, ordersService, deliveriesService, nodeEnv: config.nodeEnv, logger });
    server = http.createServer(app);
    // Connections active when close begins become idle only after their response finishes.
    server.on('request', (_req, res) => res.once('finish', () => {
      if (closing) setImmediate(() => server.closeIdleConnections());
    }));
    io = new Server(server);
    app.set('io', io);
    drainSockets = registerProductSocket(io, productsService, logger);
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
      void close().catch(() => { process.exitCode = 1; });
    });
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    logEvent('info', 'server.started', { port: config.port, nodeEnv: config.nodeEnv }, logger);
    return { app, server, io, logger, close };
  } catch (error) {
    process.exitCode = 1;
    // Invalid configuration cannot choose the logging policy or leak input values.
    if (!logger) logger = loggerFactory({ nodeEnv: 'production' });
    const event = stage === 'server.listen_failed' && error.code === 'EADDRINUSE' ? 'server.port_in_use' : stage;
    logEvent('fatal', event, { code: startupCodes[event] }, logger);
    await close().catch(() => { process.exitCode = 1; });
  }
}
if (require.main === module) void startServer();
module.exports = { startServer };
