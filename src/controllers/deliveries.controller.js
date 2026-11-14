const { paginated } = require('../utils/presentation');
module.exports = (service, receive) => ({
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
