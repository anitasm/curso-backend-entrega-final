const mongoose = require('mongoose');
const { ORDER_STATUS, DELIVERY_PRIORITY } = require('../constants');

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  price: { type: Number, required: true, min: 0, validate: Number.isFinite },
}, { _id: false });

const schema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: { type: [itemSchema], required: true, validate: items => items.length > 0 },
  deliveryAddress: { type: String, required: true, trim: true },
  total: {
    type: Number, required: true, min: 0,
    validate(value) {
      return Number.isFinite(value) && value === this.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    },
  },
  status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.CREATED, required: true },
  priority: { type: String, enum: Object.values(DELIVERY_PRIORITY), default: DELIVERY_PRIORITY.NORMAL, required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Order || mongoose.model('Order', schema);
