const { paginated } = require('../utils/presentation');
module.exports = (service, receive) => ({
  upload: async (req, res, next) => {
    try {
      const id = req.params.uid;
      const entity = await service.get(id);
      const metadata = await receive(req, res, {
        kind: 'user',
        entity,
        associate: file => service.addDocument(id, file),
        confirm: filename => service.hasDocument(id, filename),
      });
      res
        .status(201)
        .json({ status: 'success', payload: { userId: entity.id, document: metadata } });
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
      res.json({ status: 'success', payload: await service.get(req.params.uid) });
    } catch (error) {
      next(error);
    }
  },
  create: async (req, res, next) => {
    try {
      res.status(201).json({ status: 'success', payload: await service.create(req.body) });
    } catch (error) {
      next(error);
    }
  },
  update: async (req, res, next) => {
    try {
      res.json({ status: 'success', payload: await service.update(req.params.uid, req.body) });
    } catch (error) {
      next(error);
    }
  },
  remove: async (req, res, next) => {
    try {
      res.json({ status: 'success', payload: await service.remove(req.params.uid) });
    } catch (error) {
      next(error);
    }
  },
});
