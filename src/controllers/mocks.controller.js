const { USER_ROLES } = require('../constants');
const { presentUser } = require('../utils/mocks.presentation');
const AppError = require('../errors/AppError');

module.exports = service => ({
  users: async (req, res, next) => {
    try { res.json((await service.previewUsers(req.query)).map(presentUser)); }
    catch (error) { next(error); }
  },
  mockingUsers: async (req, res, next) => {
    try { res.json({ status: 'success', payload: await service.previewUsers(req.query) }); }
    catch (error) { next(error); }
  },
  mockingDrivers: async (req, res, next) => {
    try { res.json({ status: 'success', payload: await service.previewUsers(req.query, USER_ROLES.DRIVER) }); }
    catch (error) { next(error); }
  },
  mockingOrders: async (req, res, next) => {
    try { res.json({ status: 'success', payload: await service.previewOrders(req.query) }); }
    catch (error) { next(error); }
  },
  mockingDeliveries: async (req, res, next) => {
    try { res.json({ status: 'success', payload: await service.previewDeliveries(req.query) }); }
    catch (error) { next(error); }
  },
  seedUsers: async (req, res, next) => {
    try {
      const users = await service.seedUsers(req.query);
      res.status(201).json({ status: 'success', payload: { inserted: users.length, users, collection: 'users' } });
    } catch (error) { next(error); }
  },
  seed: async (req, res, next) => {
    try { res.status(201).json({ insertados: await service.seed(req.query), coleccion: 'usuarios' }); }
    catch (error) { next(error); }
  },
  generateData: async (req, res, next) => {
    try {
      if (!req.is('application/json')) throw new AppError(400, 'generateData requiere un body JSON');
      res.status(201).json({ status: 'success', payload: { insertados: await service.generateData(req.body, req.query) } });
    } catch (error) { next(error); }
  },
});
