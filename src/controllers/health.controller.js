// Liveness only: importing or calling this handler does not query MongoDB.
module.exports = nodeEnv => (_req, res) => {
  res.json({
    status: 'ok',
    environment: nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
