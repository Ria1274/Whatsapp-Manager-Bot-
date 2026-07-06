const mongoose = require('mongoose');

// Durable facts about the user: routines, preferences, learned patterns,
// and mood log entries. Read by the planner and recalled by the agent.
const memoryFactSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    fact: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      enum: ['routine', 'preference', 'pattern', 'mood', 'other'],
      default: 'other',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MemoryFact', memoryFactSchema);
