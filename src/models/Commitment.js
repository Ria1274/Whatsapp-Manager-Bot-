const mongoose = require('mongoose');

// A promise in either direction: something the user owes someone,
// or something someone owes the user. Surfaced by due_followups and prep_brief.
const commitmentSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: ['owed_by_me', 'owed_to_me'],
      required: true,
    },

    who: {
      type: String,
      required: true,
      trim: true,
    },

    what: {
      type: String,
      required: true,
      trim: true,
    },

    due: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ['open', 'done', 'dropped'],
      default: 'open',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Commitment', commitmentSchema);
