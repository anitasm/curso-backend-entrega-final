const AppError = require('../errors/AppError');
const { paginated } = require('../utils/presentation');
module.exports = service => ({
  update: async (req, res, next) => {
    try {
      if (!req.is('application/json'))
        throw new AppError('VALIDATION_ERROR', { message: 'Se requiere un body JSON' });
      res.json({ status: 'success', payload: await service.update(req.params.oid, req.body) });
    } catch (error) {
      next(error);
    }
  },
  remove: async (req, res, next) => {
    try {
      res.json({ status: 'success', payload: await service.remove(req.params.oid) });
    } catch (error) {
      next(error);
    }
  },
  transition: async (req, res, next) => {
    try {
      if (!req.is('application/json'))
        throw new AppError('VALIDATION_ERROR', { message: 'Se requiere un body JSON' });
      res.json({ status: 'success', payload: await service.transition(req.params.oid, req.body) });
    } catch (error) {
      next(error);
    }
  },
  tracking: async (req, res, next) => {
    try {
      res.json({ status: 'success', payload: await service.tracking(req.params.oid) });
    } catch (error) {
      next(error);
    }
  },
  create: async (req, res, next) => {
    try {
      if (!req.is('application/json'))
        throw new AppError('VALIDATION_ERROR', {
          message: 'El alta de pedidos requiere un body JSON',
        });
      res.status(201).json({ status: 'success', payload: await service.create(req.body) });
    } catch (error) {
      next(error);
    }
  },
  list: async (req, res, next) => {
    try {
      res.json(paginated(await service.list(req.query), req.baseUrl, req.query));
    } catch (error) {
      next(error);
    }
  },
  get: async (req, res, next) => {
    try {
      res.json({ status: 'success', payload: await service.get(req.params.oid) });
    } catch (error) {
      next(error);
    }
  },
});
