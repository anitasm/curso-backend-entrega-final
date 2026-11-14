const { paginated } = require('../utils/presentation');
module.exports = service => ({
  list: async (req, res, next) => { try { res.json(paginated(await service.list(req.query), req.baseUrl, req.query)); } catch (error) { next(error); } },
  get: async (req, res, next) => { try { res.json({ status: 'success', payload: await service.get(req.params.oid) }); } catch (error) { next(error); } },
});
