// Loaded only by Mocha. Never load dotenv or use development connection settings.
process.env.NODE_ENV = 'test';
exports.mochaHooks = {
  async afterAll() {
    const { assertResponseMatrix } = await import('./responses.mjs');
    assertResponseMatrix();
    const forbidden = Object.keys(require.cache).filter(p => /[\\/]src[\\/](models|config[\\/]env\.config)|[\\/]node_modules[\\/](mongoose|dotenv)[\\/]/.test(p));
    require('node:assert/strict').deepEqual(forbidden, [], 'La suite funcional no debe importar MongoDB ni dotenv');
  },
};
