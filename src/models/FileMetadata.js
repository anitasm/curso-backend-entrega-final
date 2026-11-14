const { Schema } = require('mongoose');
const { MAX_FILE_SIZE, FORMATS, DOCUMENT_TYPES, ORIGINAL_NAME_LIMIT } = require('../config/files.config');
module.exports = new Schema({
  originalName: { type: String, required: true, maxlength: ORIGINAL_NAME_LIMIT },
  filename: { type: String, required: true, match: /^[a-f\d-]{36}\.(pdf|jpg|png)$/ },
  path: { type: String, required: true, match: /^uploads\/(documents|licenses|proofs)\/[a-f\d-]{36}\.(pdf|jpg|png)$/ },
  mimeType: { type: String, required: true, enum: Object.keys(FORMATS) },
  size: { type: Number, required: true, min: 1, max: MAX_FILE_SIZE, validate: Number.isSafeInteger },
  type: { type: String, required: true, enum: Object.keys(DOCUMENT_TYPES) },
  uploadedAt: { type: Date, required: true },
}, { _id: false });
