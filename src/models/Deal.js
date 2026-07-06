const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true,
    },

    status: {
      type: String,
      enum: ['lead', 'live', 'stalled', 'won', 'dead'],
      default: 'lead',
    },

    // Newest note first
    notes: [
      {
        text: { type: String, trim: true },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

dealSchema.index({ phoneNumber: 1, clientName: 1 }, { unique: true });

module.exports = mongoose.model('Deal', dealSchema);
