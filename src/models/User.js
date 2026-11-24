const mongoose = require('mongoose');
const { USER_ROLES } = require('../constants');
const FileMetadata = require('./FileMetadata');
const schema = new mongoose.Schema({
  referenceRevision: { type: Number, default: 0, select: false },
  documents: { type: [FileMetadata], default: undefined, select: false },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  role: { type: String, enum: Object.values(USER_ROLES), default: USER_ROLES.USER, required: true },
}, { timestamps: true, versionKey: false });
module.exports = mongoose.models.User || mongoose.model('User', schema);
