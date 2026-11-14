const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const AppError = require('../errors/AppError');
const { logEvent } = require('../utils/log-events');
const { MAX_FILE_SIZE, FORMATS, DOCUMENT_TYPES, ORIGINAL_NAME_LIMIT } = require('../config/files.config');
const DEFAULT_ROOT = path.resolve(__dirname, '../../uploads');
const filesystemCodes = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS', 'ENOENT', 'ENOTDIR', 'EMFILE', 'ENFILE', 'EEXIST']);
function parserError(error) {
  if (error instanceof AppError) return error;
  if (error.code === 'LIMIT_FILE_SIZE') return new AppError('FILE_TOO_LARGE');
  if (error instanceof multer.MulterError && error.code !== 'STREAM_DESTROYED') return new AppError('INVALID_UPLOAD_FIELD');
  return new AppError(filesystemCodes.has(error.code) ? 'FILE_SAVE_ERROR' : 'INVALID_MULTIPART');
}
function originalName(name) {
  return path.posix.basename(String(name).replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, ORIGINAL_NAME_LIMIT).trim() || 'archivo';
}
module.exports = function createPrivateUpload({ root = DEFAULT_ROOT, io = fs } = {}) {
  root = path.resolve(root);
  // Only constants and server UUIDs form paths. Import/construction never creates directories.
  return async function receive(req, res, { kind, entity, associate, confirm }) {
    if (!req.is('multipart/form-data')) throw new AppError('INVALID_MULTIPART');
    const field = kind === 'user' ? 'document' : 'proof';
    const attempt = path.join(root, 'temporary', randomUUID());
    const owned = new Set();
    let preserve = false;
    async function cleanup() {
      let failed = false;
      for (const file of owned) {
        try { await io.unlink(file); }
        catch (error) { if (error.code !== 'ENOENT') failed = true; }
      }
      try { await io.rmdir(attempt); }
      catch (error) { if (error.code !== 'ENOENT') failed = true; }
      if (failed) logEvent('warning', 'upload.cleanup_failed');
    }
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => io.mkdir(attempt, { recursive: true }).then(() => cb(null, attempt), cb),
      filename: (_req, _file, cb) => {
        const name = randomUUID() + '.part'; owned.add(path.join(attempt, name)); cb(null, name);
      },
    });
    const parse = multer({
      storage, defParamCharset: 'utf8',
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: kind === 'user' ? 1 : 0, parts: kind === 'user' ? 2 : 1, fieldSize: 32, fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 },
      fileFilter: (_req, file, cb) => cb(Object.hasOwn(FORMATS, file.mimetype) ? null : new AppError('INVALID_FILE_TYPE'), Object.hasOwn(FORMATS, file.mimetype)),
    }).single(field);
    try {
      await new Promise((resolve, reject) => parse(req, res, error => error ? reject(parserError(error)) : resolve()));
      if (req.aborted) throw new AppError('INVALID_MULTIPART');
      if (Object.keys(req.body || {}).some(key => kind !== 'user' || key !== 'type')) throw new AppError('INVALID_UPLOAD_FIELD');
      if (kind === 'user' && req.body.type !== undefined && typeof req.body.type !== 'string') throw new AppError('INVALID_UPLOAD_FIELD');
      const type = kind === 'user' ? req.body.type : 'delivery_proof';
      if (kind === 'user' && (!['user_document', 'driver_license'].includes(type) || (type === 'driver_license' && entity.role !== 'driver'))) throw new AppError('INVALID_DOCUMENT_TYPE');
      if (!req.file) throw new AppError('FILE_REQUIRED');
      if (req.file.size > MAX_FILE_SIZE) throw new AppError('FILE_TOO_LARGE');
      if (!req.file.size || !DOCUMENT_TYPES[type].mimeTypes.includes(req.file.mimetype)) throw new AppError('INVALID_FILE_TYPE');
      let detected, metadata, finalPath;
      try {
        const handle = await io.open(req.file.path, 'r');
        try {
          const head = Buffer.alloc(16);
          const { bytesRead } = await handle.read(head, 0, head.length, 0);
          detected = Object.entries(FORMATS).find(([, format]) => bytesRead >= format.signature.length && head.subarray(0, format.signature.length).equals(format.signature));
        } finally { await handle.close(); }
        if (!detected || detected[0] !== req.file.mimetype) throw new AppError('INVALID_FILE_TYPE');
        const filename = randomUUID() + detected[1].extension;
        const directory = DOCUMENT_TYPES[type].directory;
        await io.mkdir(path.join(root, directory), { recursive: true });
        finalPath = path.join(root, directory, filename);
        owned.add(finalPath);
        await io.rename(req.file.path, finalPath);
        owned.delete(req.file.path);
        metadata = { originalName: originalName(req.file.originalname), filename, path: `uploads/${directory}/${filename}`, mimeType: detected[0], size: req.file.size, type, uploadedAt: new Date() };
      } catch (error) { throw error instanceof AppError ? error : new AppError('FILE_SAVE_ERROR'); }
      if (req.aborted) throw new AppError('INVALID_MULTIPART');
      try { await associate(metadata); }
      catch (error) {
        // A known rejection cannot have committed an association.
        if (error instanceof AppError && ['USER_NOT_FOUND', 'DELIVERY_NOT_FOUND', 'VALIDATION_ERROR'].includes(error.code)) throw error;
        let associated;
        try { associated = await confirm(metadata.filename); }
        catch {
          preserve = true;
          logEvent('error', 'upload.reconciliation_required');
          throw error;
        }
        if (!associated) throw error;
        // The write committed but its acknowledgement was lost: success is now confirmed.
      }
      preserve = true;
      logEvent('info', kind === 'user' ? 'user.document_added' : 'delivery.proof_added');
      return metadata;
    } finally {
      if (preserve) for (const filename of owned) if (!filename.startsWith(attempt + path.sep)) owned.delete(filename);
      await cleanup();
    }
  };
};
