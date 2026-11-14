const MAX_FILE_SIZE = 5 * 1024 * 1024;
const FORMATS = Object.freeze({
  'application/pdf': Object.freeze({ extension: '.pdf', signature: Buffer.from('%PDF-') }),
  'image/jpeg': Object.freeze({ extension: '.jpg', signature: Buffer.from([0xff, 0xd8, 0xff]) }),
  'image/png': Object.freeze({ extension: '.png', signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }),
});
const DOCUMENT_TYPES = Object.freeze({
  user_document: Object.freeze({ directory: 'documents', mimeTypes: Object.keys(FORMATS) }),
  driver_license: Object.freeze({ directory: 'licenses', mimeTypes: ['application/pdf'] }),
  delivery_proof: Object.freeze({ directory: 'proofs', mimeTypes: Object.keys(FORMATS) }),
});
module.exports = { MAX_FILE_SIZE, FORMATS, DOCUMENT_TYPES, ORIGINAL_NAME_LIMIT: 120 };
