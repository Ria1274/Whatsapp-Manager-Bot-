const mongoose = require('mongoose');

const conversationLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    sender: { type: String, required: true }, // e.g. "USER: +123456789" or "BOT"
    detectedIntent: { type: String, default: 'none' },
    extractedEntities: { type: mongoose.Schema.Types.Mixed, default: {} },
    responseText: { type: String },
  },
  {
    timestamps: true, // Auto adds createdAt
  }
);

module.exports = mongoose.model('ConversationLog', conversationLogSchema);
