const { randomUUID } = require('node:crypto');
const { requestContext } = require('../utils/request-context');
const { logEvent } = require('../utils/log-events');
module.exports = logger => (req, res, next) => {
  const requestId = randomUUID();
  const start = process.hrtime.bigint();
  const context = Object.freeze({ requestId, logger });
  res.setHeader('X-Request-Id', requestId);
  let recorded = false;
  const finish = () => {
    if (recorded) return;
    recorded = true;
    requestContext.run(context, () => logEvent('http', 'http.access', {
      method: req.method, statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6, aborted: !res.writableFinished,
    }));
  };
  res.once('finish', finish);
  res.once('close', finish);
  requestContext.run(context, next);
};
