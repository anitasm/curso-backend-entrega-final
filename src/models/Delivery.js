const mongoose = require('mongoose');
const { DELIVERY_STATUS } = require('../constants');

const schema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String, enum: Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.PENDING, required: true,
    validate(value) { return value === (this.driver ? DELIVERY_STATUS.ASSIGNED : DELIVERY_STATUS.PENDING); },
  },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Delivery || mongoose.model('Delivery', schema);
