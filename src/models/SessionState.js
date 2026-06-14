const mongoose = require('mongoose');

const sessionStateSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    pendingAction: {
      type: String, // e.g. 'awaiting_wake_up_reply', 'awaiting_manage_decision'
      default: null,
    },
    pendingIntent: {
      type: String, // The intent we will execute once the pending info is supplied
      default: null,
    },
    pendingEntities: {
      type: mongoose.Schema.Types.Mixed, // Temporary entities collected so far
      default: {},
    },
    lastBotQuestion: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 60 * 1000), // Default session expiration: 15 minutes
    },
  },
  {
    timestamps: true,
  }
);

// Add index to automatically delete expired sessions
sessionStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SessionState', sessionStateSchema);
