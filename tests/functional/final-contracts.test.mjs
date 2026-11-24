// HTTP/controller contract tests with explicit service doubles. Real persistence lives in tests/integration.
import { expect } from 'chai';
import request from 'supertest';
import createApp from '../../src/app.js';
import AppError from '../../src/errors/AppError.js';
import getSpec from '../../src/docs/index.js';
import { response, error } from '../support/responses.mjs';
const spec = getSpec(), id = '000000000000000000000001';
const operations = [
  ['/api/orders/{oid}', 'put', 'ordersService', 'update'], ['/api/orders/{oid}', 'delete', 'ordersService', 'remove'],
  ['/api/orders/{oid}/status', 'patch', 'ordersService', 'transition'], ['/api/orders/{oid}/tracking', 'get', 'ordersService', 'tracking'],
  ['/api/deliveries', 'post', 'deliveriesService', 'create'], ['/api/deliveries/{did}/driver', 'patch', 'deliveriesService', 'assign'],
  ['/api/products', 'get', 'productsService', 'getProducts'], ['/api/products', 'post', 'productsService', 'createProduct'],
  ['/api/products/{pid}', 'get', 'productsService', 'getProductById'], ['/api/products/{pid}', 'put', 'productsService', 'updateProduct'], ['/api/products/{pid}', 'delete', 'productsService', 'deleteProduct'],
  ['/api/carts', 'post', 'cartsService', 'createCart'], ['/api/carts/{cid}', 'get', 'cartsService', 'getCartById'], ['/api/carts/{cid}', 'put', 'cartsService', 'updateCartProducts'], ['/api/carts/{cid}', 'delete', 'cartsService', 'clearCart'],
  ['/api/carts/{cid}/product/{pid}', 'post', 'cartsService', 'addProductToCart'], ['/api/carts/{cid}/products/{pid}', 'delete', 'cartsService', 'removeProductFromCart'], ['/api/carts/{cid}/products/{pid}', 'put', 'cartsService', 'updateProductQuantityInCart'],
  ['/api/orders', 'post', 'ordersService', 'create', ['503']], ['/api/users/{uid}', 'delete', 'usersService', 'remove', ['409', '503']],
];
for (const [route, method, service, operation, only] of operations) describe(method.toUpperCase() + ' ' + route + ': traducción HTTP', () => {
  for (const [status, source] of Object.entries(spec.paths[route][method].responses)) {
    if (only && !only.includes(status)) continue;
    const documented = source.$ref ? spec.components.responses[source.$ref.split('/').pop()] : source;
    const examples = documented.content['application/json'].examples;
    if (Number(status) >= 400) {
      for (const code of Object.keys(examples)) it('propaga ' + code + ' sin detalles internos', async () => {
        const serviceDouble = { [operation]: async () => { throw new AppError(code, { cause: new Error('PRIVATE_TOKEN') }); } };
        const app = createApp({ [service]: serviceDouble, nodeEnv: 'test', upload: (_req, _res, next) => next() });
        const res = await request(app)[method](route.replace(/\{[^}]+\}/g, id)).send({});
        error(res, route, method, code);
      });
    } else it('devuelve el resultado del servicio y el estado ' + status, async () => {
      const payload = operation === 'getProducts' ? { docs: [], page: 1, totalPages: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null } : { id };
      let called = false;
      const app = createApp({ [service]: { [operation]: async () => { called = true; return payload; } }, nodeEnv: 'test', upload: (_req, _res, next) => next() });
      const res = await request(app)[method](route.replace(/\{[^}]+\}/g, id)).send({});
      const body = response(res, route, method, Number(status)); expect(called).to.equal(true); expect(body.status).to.equal('success');
      expect(body.payload).to.deep.equal(operation === 'getProducts' ? [] : payload);
    });
  }
});
