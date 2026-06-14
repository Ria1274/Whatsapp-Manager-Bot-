const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema(
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
      required: [true, 'Goal title is required'],
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    category: {
      type: String,
      enum: ['health', 'startup', 'academic', 'personal', 'finance', 'career', 'other'],
      default: 'other',
    },

    targetDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: ['active', 'completed', 'paused', 'cancelled'],
      default: 'active',
    },

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },

    targetMetric: {
      type: String,
      trim: true,
      default: '',
    },

    currentValue: {
      type: Number,
      default: 0,
    },

    targetValue: {
      type: Number,
      default: 0,
    },

    unit: {
      type: String,
      trim: true,
      default: '',
    },

    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'custom', 'none'],
      default: 'none',
    },

    weeklyCommitment: {
      type: Number,
      default: 0,
    },

    linkedTasks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
      },
    ],

    milestones: [
      {
        title: {
          type: String,
          required: true,
          trim: true,
        },
        targetDate: {
          type: Date,
        },
        isCompleted: {
          type: Boolean,
          default: false,
        },
      },
    ],

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

module.exports = mongoose.model('Goal', goalSchema);
