const User = require('../models/User');

/**
 * Retrieve user by phone number. If user doesn't exist, create one.
 * 
 * @param {string} phoneNumber - User phone number
 * @returns {Promise<object>} User document
 */
const getUserProfile = async (phoneNumber) => {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = await User.create({ phoneNumber });
  }
  return user;
};

module.exports = {
  getUserProfile,
};
