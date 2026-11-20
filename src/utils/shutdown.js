const { logEvent } = require('./log-events');
const { SHUTDOWN_TIMEOUT_MS } = require('../config/performance.config');

// Resources are resolved lazily: this also handles partially completed startup.
module.exports = function createShutdown({ resources, removeListeners, onStart = () => {}, timeoutMs = SHUTDOWN_TIMEOUT_MS, forceExit = code => process.exit(code) }) {
  let closing, disconnecting, flushing;
  const disconnectOnce = () => {
    if (!disconnecting) {
      try { disconnecting = Promise.resolve(resources().disconnect()); }
      catch (error) { disconnecting = Promise.reject(error); }
    }
    return disconnecting;
  };
  const flushOnce = () => {
    if (!flushing) {
      try { flushing = Promise.resolve(resources().logger?.shutdown?.()); }
      catch (error) { flushing = Promise.reject(error); }
    }
    return flushing;
  };
  return function close() {
    if (closing) return closing;
    // Schedule work after assigning closing, so even reentrant calls reuse it.
    closing = Promise.resolve().then(async () => {
      const previousExitCode = process.exitCode;
      // A pending promise alone cannot keep Node alive; unfinished shutdown is not success.
      process.exitCode = previousExitCode || 1;
      onStart();
      const { server, io, logger, drainSockets } = resources();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          process.exitCode = 1;
          logEvent('fatal', 'server.shutdown_timeout', {}, logger);
          // HTTP closeAllConnections excludes upgrades; terminate them explicitly.
          try {
            for (const client of Object.values(io?.engine?.clients || {})) {
              client.transport?.socket?.terminate?.();
              client.close(true);
            }
            io?.disconnectSockets(true);
          } catch { /* Deadline must still terminate the process. */ }
          try { server?.closeAllConnections(); } catch { /* Best effort. */ }
          void disconnectOnce().catch(() => {});
          void flushOnce().catch(() => {});
          reject(new Error('Plazo de cierre agotado'));
          forceExit(1);
        }, timeoutMs);
        timer.unref();
      });
      const drain = async () => {
        let failed = false;
        const attempt = async work => {
          try { await work(); }
          catch { failed = true; process.exitCode = 1; logEvent('warning', 'server.cleanup_failed', {}, logger); }
        };
        // Socket.IO closes its HTTP server once; its callback waits for HTTP drain.
        await attempt(async () => {
          const socketTasks = drainSockets?.();
          const httpClosed = new Promise((resolve, reject) => {
            const done = error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve();
            if (io) Promise.resolve(io.close(done)).catch(reject);
            else if (server?.listening) server.close(done);
            else resolve();
          });
          const outcomes = await Promise.allSettled([socketTasks, httpClosed]);
          if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('No se pudo drenar el servidor');
        });
        await attempt(disconnectOnce);
        if (!failed) logEvent('info', 'server.stopped', {}, logger);
        await attempt(flushOnce);
        if (failed) throw new Error('No se pudo completar el cierre del servidor');
      };
      try { await Promise.race([drain(), deadline]); process.exitCode = previousExitCode; }
      finally { clearTimeout(timer); removeListeners(); }
    });
    return closing;
  };
};
