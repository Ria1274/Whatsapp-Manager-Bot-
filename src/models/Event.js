const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },

    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    category: {
      type: String,
      enum: ['startup', 'personal', 'health', 'academic', 'work', 'social', 'other'],
      default: 'other',
    },

    startTime: {
      type: Date,
      required: true,
    },

    endTime: {
      type: Date,
      required: true,
    },

    location: {
      type: String,
      trim: true,
      default: '',
    },

    isMovable: {
      type: Boolean,
      default: false,
    },

    preparationRequiredMinutes: {
      type: Number,
      default: 0,
    },

    preparationTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },

    source: {
      type: String,
      enum: ['whatsapp', 'calendar', 'manual', 'system'],
      default: 'manual',
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Event', eventSchema);
