import { expect } from 'chai';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import AppError from '../../src/errors/AppError.js';
import { fixture, userInput, absentId, privateFailure } from '../support/fixture.mjs';
import { response, error } from '../support/responses.mjs';
import { pdf, png, jpeg, files } from '../support/files.mjs';
const maximum = 5242880;

for (const kind of ['user', 'delivery']) describe('Archivos privados: ' + kind, () => {
  let root, f, api, entity, route, documented, field, io;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shipnow-private-'));
    io = { ...fs };
    f = fixture({ uploadRoot: root, uploadIO: io }); api = request(f.app);
    entity = kind === 'user' ? await f.usersRepository.create({ ...userInput, role: 'user' }) : f.seedDelivery();
    field = kind === 'user' ? 'document' : 'proof';
    route = kind === 'user' ? '/api/users/' + entity.id + '/documents' : '/api/deliveries/' + entity.id + '/proof';
    documented = kind === 'user' ? '/api/users/{uid}/documents' : '/api/deliveries/{did}/proof';
    f.calls.length = 0;
  });
  afterEach(async () => { f.dispose(); f = api = null; await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const entries = () => (kind === 'user' ? f.documents : f.proofs).get(entity.id) || [];
  const post = (bytes = pdf, mime = 'application/pdf', type = 'user_document') => {
    const req = api.post(route); if (kind === 'user' && type !== null) req.field('type', type);
    return req.attach(field, bytes, { filename: 'sintetico.pdf', contentType: mime });
  };
  const clean = async () => { expect(await files(root)).to.deep.equal([]); expect(entries()).to.deep.equal([]); };
  it('guarda exactamente los bytes, asocia metadatos y no los expone en GET', async () => {
    const r = await post(); const body = response(r, documented, 'post', 201);
    expect(body).to.have.all.keys('status', 'payload'); expect(body.status).to.equal('success');
    expect(body.payload).to.have.all.keys(kind + 'Id', field); expect(body.payload[kind + 'Id']).to.equal(entity.id);
    const meta = body.payload[field];
    expect(meta).to.have.all.keys('originalName', 'filename', 'path', 'mimeType', 'size', 'type', 'uploadedAt');
    expect(meta).to.include({ originalName: 'sintetico.pdf', mimeType: 'application/pdf', size: pdf.length, type: kind === 'user' ? 'user_document' : 'delivery_proof' });
    expect(meta.filename).to.match(/^[a-f\d-]{36}\.pdf$/); expect(Number.isFinite(Date.parse(meta.uploadedAt))).to.equal(true);
    expect(meta.path).to.equal('uploads/' + (kind === 'user' ? 'documents' : 'proofs') + '/' + meta.filename);
    const disk = path.join(root, meta.path.slice('uploads/'.length)); expect(await fs.readFile(disk)).to.deep.equal(pdf);
    expect(entries()).to.have.length(1); expect(JSON.parse(JSON.stringify(entries()[0]))).to.deep.equal(meta);
    const normal = await api.get(kind === 'user' ? '/api/users/' + entity.id : '/api/deliveries/' + entity.id);
    expect(normal.status).to.equal(200); expect(normal.body.payload).not.to.have.any.keys('documents', 'proofs');
    const privateGet = await api.get('/' + meta.path); expect(privateGet.status).to.equal(404); expect(privateGet.body.error).to.equal('ROUTE_NOT_FOUND');
    const successes = f.logs.filter(l => l.event === (kind === 'user' ? 'user.document_added' : 'delivery.proof_added'));
    expect(successes).to.have.length(1); expect(successes[0]).to.include({ level: 'info', requestId: r.headers['x-request-id'] });
    expect(JSON.stringify(f.logs)).not.to.include(meta.originalName).and.not.to.include(meta.filename).and.not.to.include(root);
    if (kind === 'delivery') expect(f.deliveries.get(entity.id).status).to.equal('pending');
  });
  for (const [bytes, mime, extension] of [[png, 'image/png', '.png'], [jpeg, 'image/jpeg', '.jpg']]) it('verifica firma ' + mime + ' y fija extensión canónica', async () => {
    const r = await post(bytes, mime); const meta = response(r, documented, 'post', 201).payload[field];
    expect(meta.filename.endsWith(extension)).to.equal(true); expect(meta.mimeType).to.equal(mime);
    expect(await fs.readFile(path.join(root, meta.path.slice(8)))).to.deep.equal(bytes);
  });
  it('rechaza archivo ausente con formulario válido', async () => {
    let req = api.post(route);
    if (kind === 'user') req = req.field('type', 'user_document');
    else req = req.set('Content-Type', 'multipart/form-data; boundary=empty').send('--empty--\r\n');
    error(await req, documented, 'post', 'FILE_REQUIRED'); await clean();
  });
  it('rechaza formato/boundary inválido y multipart truncado', async () => {
    error(await api.post(route).type('json').send('{"broken":'), documented, 'post', 'INVALID_JSON');
    error(await api.post(route).send({ value: 'x'.repeat(110000) }), documented, 'post', 'PAYLOAD_TOO_LARGE');
    error(await api.post(route).send({}), documented, 'post', 'INVALID_MULTIPART');
    error(await api.post(route).set('Content-Type', 'multipart/form-data').send('body'), documented, 'post', 'INVALID_MULTIPART');
    const raw = '--test\r\nContent-Disposition: form-data; name="' + field + '"; filename="x.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\npartial';
    error(await api.post(route).set('Content-Type', 'multipart/form-data; boundary=test').send(raw), documented, 'post', 'INVALID_MULTIPART');
    await clean();
  });
  it('rechaza campo incorrecto, campos extra y archivos múltiples', async () => {
    error(await api.post(route).attach('wrong', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }), documented, 'post', 'INVALID_UPLOAD_FIELD');
    error(await post().field('extra', 'x'), documented, 'post', 'INVALID_UPLOAD_FIELD');
    error(await post().attach(field, pdf, { filename: 'x.pdf', contentType: 'application/pdf' }), documented, 'post', 'INVALID_UPLOAD_FIELD');
    await clean();
  });
  it('rechaza MIME prohibido, firma falsa, discordancia y archivo vacío', async () => {
    for (const [bytes, mime] of [[pdf, 'text/plain'], [Buffer.from('false'), 'application/pdf'], [png, 'application/pdf'], [Buffer.alloc(0), 'application/pdf']]) {
      error(await post(bytes, mime), documented, 'post', 'INVALID_FILE_TYPE'); await clean();
    }
  });
  it('acepta 5 MiB exactos y rechaza un byte adicional sin borrar el archivo anterior', async () => {
    const exact = Buffer.alloc(maximum, 32); pdf.copy(exact);
    const ok = await post(exact); response(ok, documented, 'post', 201); expect(ok.body.payload[field].size).to.equal(maximum);
    const previous = await files(root); expect(previous).to.have.length(1);
    error(await post(Buffer.concat([exact, Buffer.from('x')])), documented, 'post', 'FILE_TOO_LARGE');
    expect(await files(root)).to.deep.equal(previous); expect(entries()).to.have.length(1); expect(await fs.readFile(previous[0])).to.deep.equal(exact);
  });
  it('valida ID y recurso antes de crear directorios de carga', async () => {
    error(await api.post(route.replace(entity.id, 'bad')).attach(field, pdf, 'x.pdf'), documented, 'post', 'INVALID_ID');
    error(await api.post(route.replace(entity.id, absentId)).attach(field, pdf, 'x.pdf'), documented, 'post', kind === 'user' ? 'USER_NOT_FOUND' : 'DELIVERY_NOT_FOUND');
    expect(await fs.readdir(root)).to.deep.equal([]); expect(entries()).to.deep.equal([]);
  });
  it('un fallo de filesystem posterior al traslado limpia solo el intento', async () => {
    io.rename = async (from, to) => { await fs.rename(from, to); throw Object.assign(privateFailure(), { code: 'EIO' }); };
    error(await post(), documented, 'post', 'FILE_SAVE_ERROR'); await clean();
  });
  it('un fallo confirmado de persistencia limpia el archivo', async () => {
    f.faults[kind === 'user' ? 'users.addDocument' : 'deliveries.addProof'] = privateFailure();
    error(await post(), documented, 'post', 'DATABASE_ERROR'); await clean();
  });
  it('recurso desaparecido antes del push devuelve 404 y limpia', async () => {
    if (kind === 'user') f.usersRepository.addDocument = async () => null;
    else f.deliveriesRepository.addProof = async () => null;
    error(await post(), documented, 'post', kind === 'user' ? 'USER_NOT_FOUND' : 'DELIVERY_NOT_FOUND'); await clean();
  });
  it('asociación confirmada tras perder acuse conserva archivo y responde éxito', async () => {
    const repo = kind === 'user' ? f.usersRepository : f.deliveriesRepository;
    const method = kind === 'user' ? 'addDocument' : 'addProof', original = repo[method];
    repo[method] = async (...args) => { await original(...args); throw new AppError('DATABASE_ERROR'); };
    response(await post(), documented, 'post', 201); expect(entries()).to.have.length(1); expect(await files(root)).to.have.length(1);
  });
  it('resultado ambiguo sin confirmación conserva archivo y registra reconciliación segura', async () => {
    f.faults[kind === 'user' ? 'users.addDocument' : 'deliveries.addProof'] = privateFailure();
    f.faults[kind === 'user' ? 'users.hasDocument' : 'deliveries.hasProof'] = privateFailure();
    error(await post(), documented, 'post', 'DATABASE_ERROR'); expect(await files(root)).to.have.length(1); expect(entries()).to.deep.equal([]);
    expect(f.logs.filter(l => l.event === 'upload.reconciliation_required')).to.have.length(1);
    expect(JSON.stringify(f.logs)).not.to.include(root).and.not.to.include('PRIVATE_TOKEN');
  });
  it('dos cargas concurrentes conservan dos asociaciones independientes', async () => {
    const results = await Promise.all([post(), post()]); results.forEach(r => response(r, documented, 'post', 201));
    expect(entries()).to.have.length(2); expect(new Set(entries().map(d => d.filename)).size).to.equal(2); expect(await files(root)).to.have.length(2);
  });
  it('un cliente que aborta durante el almacenamiento temporal no deja archivos ni asociaciones', async () => {
    const server = http.createServer(f.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let client;
    const cleaned = Promise.withResolvers();
    io.mkdir = async (...args) => { const result = await fs.mkdir(...args); client.destroy(); return result; };
    io.rmdir = async (...args) => { try { return await fs.rmdir(...args); } finally { cleaned.resolve(); } };
    try {
      client = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=abort' } });
      client.on('error', () => {});
      client.write('--abort\r\nContent-Disposition: form-data; name="' + field + '"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\npartial');
      await cleaned.promise;
      await clean();
    } finally { client?.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  it('un fallo al enviar la respuesta no borra el archivo ya asociado', async () => {
    const original = f.app.response.json;
    f.app.response.json = function (body) { if (this.statusCode === 201) throw privateFailure(); return original.call(this, body); };
    error(await post(), documented, 'post', 'INTERNAL_SERVER_ERROR');
    expect(entries()).to.have.length(1); expect(await files(root)).to.have.length(1);
  });
  it('un fallo al crear el directorio devuelve FILE_SAVE_ERROR sin asociar', async () => {
    io.mkdir = async () => { throw Object.assign(privateFailure(), { code: 'EACCES' }); };
    error(await post(), documented, 'post', 'FILE_SAVE_ERROR'); await clean();
  });
  it('fallo de limpieza conserva el error original y emite una advertencia segura', async () => {
    io.unlink = async () => { throw Object.assign(privateFailure(), { code: 'EACCES' }); };
    error(await post(Buffer.from('false')), documented, 'post', 'INVALID_FILE_TYPE');
    expect(entries()).to.deep.equal([]); expect(f.logs.some(l => l.event === 'upload.cleanup_failed' && l.level === 'warning')).to.equal(true);
    expect(JSON.stringify(f.logs)).not.to.include(root).and.not.to.include('PRIVATE_TOKEN');
  });
  if (kind === 'user') {
    it('type ausente/inválido, repetido o no escalar no persiste', async () => {
      error(await post(pdf, 'application/pdf', null), documented, 'post', 'INVALID_DOCUMENT_TYPE');
      error(await post(pdf, 'application/pdf', 'other'), documented, 'post', 'INVALID_DOCUMENT_TYPE');
      error(await post().field('type', 'driver_license'), documented, 'post', 'INVALID_UPLOAD_FIELD');
      error(await post(pdf, 'application/pdf', null).field('type[x]', 'user_document'), documented, 'post', 'INVALID_UPLOAD_FIELD');
      await clean();
    });
    it('type después del archivo decide el destino de una licencia PDF de driver', async () => {
      entity = await f.usersRepository.create({ ...userInput, email: 'driver@example.test', role: 'driver' }); route = '/api/users/' + entity.id + '/documents';
      const r = await api.post(route).attach('document', pdf, { filename: 'license.png', contentType: 'application/pdf' }).field('type', 'driver_license');
      const meta = response(r, documented, 'post', 201).payload.document; expect(meta.type).to.equal('driver_license'); expect(meta.path).to.match(/^uploads\/licenses\/.+\.pdf$/);
      error(await post(png, 'image/png', 'driver_license'), documented, 'post', 'INVALID_FILE_TYPE'); expect(entries()).to.have.length(1);
    });
    it('licencia para perfil user es tipo incompatible', async () => {
      error(await post(pdf, 'application/pdf', 'driver_license'), documented, 'post', 'INVALID_DOCUMENT_TYPE'); await clean();
    });
    it('nombre original queda acotado y no forma la ruta', async () => {
      const r = await api.post(route).field('type', 'user_document').attach('document', pdf, { filename: '..\\private\\' + 'x'.repeat(150) + '\n.pdf', contentType: 'application/pdf' });
      const meta = response(r, documented, 'post', 201).payload.document;
      expect(meta.originalName.length).to.be.at.most(120); expect(meta.originalName).not.to.match(/[\\/\x00-\x1f]/); expect(meta.filename).not.to.include('xxx');
    });
  }
});
