const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Contact name is required'],
      trim: true,
    },

    role: {
      type: String,
      trim: true,
      default: '',
    },

    company: {
      type: String,
      trim: true,
      default: '',
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },

    lastMentionedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

contactSchema.index({ phoneNumber: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
