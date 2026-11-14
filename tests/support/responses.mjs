import { expect } from 'chai';
import getSpec from '../../src/docs/index.js';
import dictionary from '../../src/errors/error-dictionary.js';
const spec = getSpec();
const covered = new Set();
export const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export function response(res, route, method, status) {
  expect(res.status).to.equal(status);
  expect(res.headers['content-type']).to.match(/^application\/json\b/);
  expect(res.headers['x-request-id']).to.match(uuid);
  expect(spec.paths[route][method.toLowerCase()].responses).to.have.property(String(status));
  covered.add(`${method.toLowerCase()} ${route} ${status}`);
  return res.body;
}
export function error(res, route, method, code, message = dictionary[code].message) {
  const body = response(res, route, method, dictionary[code].status);
  let documented = spec.paths[route][method.toLowerCase()].responses[res.status];
  if (documented.$ref) documented = spec.components.responses[documented.$ref.split('/').pop()];
  expect(documented.content['application/json'].examples).to.have.property(code);
  expect(body).to.have.all.keys('status', 'error', 'message');
  expect(body).to.deep.equal({ status: 'error', error: code, message });
  expect(JSON.stringify(body)).not.to.match(/PRIVATE_TOKEN|private:password|email@private|stack|cause/);
  return body;
}
export function page(body) {
  expect(body).to.have.all.keys('status', 'payload', 'totalPages', 'page', 'hasPrevPage', 'hasNextPage', 'prevPage', 'nextPage', 'prevLink', 'nextLink');
  expect(body.status).to.equal('success'); expect(body.payload).to.be.an('array');
}
export function persisted(row) {
  expect(row.id).to.match(/^[a-f\d]{24}$/i); expect(row._id).to.equal(row.id);
  expect(Number.isFinite(Date.parse(row.createdAt))).to.equal(true);
  expect(Number.isFinite(Date.parse(row.updatedAt))).to.equal(true);
}
export function assertResponseMatrix() {
  const missing = [];
  for (const [route, path] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(path)) {
    for (const status of Object.keys(op.responses)) {
      const key = `${method} ${route} ${status}`;
      if (!covered.has(key)) missing.push(key);
    }
  }
  expect(missing, 'Respuestas OpenAPI sin verificación funcional').to.deep.equal([]);
}
