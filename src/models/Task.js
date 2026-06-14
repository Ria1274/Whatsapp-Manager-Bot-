const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
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
      required: [true, 'Task title is required'],
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    category: {
      type: String,
      enum: ['personal', 'startup', 'health', 'academic', 'work', 'finance', 'social', 'other'],
      default: 'other',
    },

    dueDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled', 'deferred'],
      default: 'pending',
    },

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },

    estimatedDurationMinutes: {
      type: Number,
      default: 30,
      min: 5,
    },

    scheduledStart: {
      type: Date,
    },

    scheduledEnd: {
      type: Date,
    },

    isFixedTime: {
      type: Boolean,
      default: false,
    },

    canBeRescheduled: {
      type: Boolean,
      default: true,
    },

    canBeSkipped: {
      type: Boolean,
      default: true,
    },

    energyRequired: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },

    source: {
      type: String,
      enum: ['whatsapp', 'manual', 'calendar', 'system'],
      default: 'manual',
    },

    relatedGoal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Goal',
      default: null,
    },

    reminderTimes: [
      {
        type: Date,
      },
    ],

    recurrence: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly'],
      default: 'none',
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

module.exports = mongoose.model('Task', taskSchema);
