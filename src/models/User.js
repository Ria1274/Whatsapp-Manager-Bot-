const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
    },
    reminderTime: {
      type: String, // format HH:mm e.g., '09:00'
      default: '09:00', 
    },
    timezone: {
      type: String,
      default: 'UTC', // Keeping it simple for MVP
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
