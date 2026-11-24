const AppError = require('../errors/AppError');
const { paginated } = require('../utils/presentation');
module.exports = (service, receive) => ({
  create: async (req, res, next) => { try { if (!req.is('application/json')) throw new AppError('VALIDATION_ERROR', { message: 'Se requiere un body JSON' }); res.status(201).json({ status: 'success', payload: await service.create(req.body) }); } catch (error) { next(error); } },
  assign: async (req, res, next) => { try { if (!req.is('application/json')) throw new AppError('VALIDATION_ERROR', { message: 'Se requiere un body JSON' }); res.json({ status: 'success', payload: await service.assign(req.params.did, req.body) }); } catch (error) { next(error); } },
  upload: async (req, res, next) => {
    try {
      const id = req.params.did;
      const entity = await service.get(id);
      const metadata = await receive(req, res, { kind: 'delivery', entity, associate: file => service.addProof(id, file), confirm: filename => service.hasProof(id, filename) });
      res.status(201).json({ status: 'success', payload: { deliveryId: entity.id, proof: metadata } });
    } catch (error) { next(error); }
  },
  list: async (req, res, next) => { try { res.json(paginated(await service.list(req.query), req.baseUrl, req.query)); } catch (error) { next(error); } },
  get: async (req, res, next) => { try { res.json({ status: 'success', payload: await service.get(req.params.did) }); } catch (error) { next(error); } },
});
