const ConversationLog = require('../models/ConversationLog');
const SessionState = require('../models/SessionState');

/**
 * Build conversational context for a given sender number.
 * Fetches recent logs and determines if the bot is awaiting a specific response.
 * 
 * @param {string} senderNumber - Sender's phone number
 * @returns {Promise<object>} Context payload
 */
async function buildContext(senderNumber) {
  try {
    const cleanSender = senderNumber.replace('whatsapp:', '').trim();

    // 1. Fetch last 8 logs relating to this user or the bot
    const logs = await ConversationLog.find({
      $or: [
        { sender: `USER: ${senderNumber}` },
        { sender: `USER: ${cleanSender}` },
        { sender: 'BOT' }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(8);

    // Format logs into user/bot strings for LLM reading
    const recentConversation = logs
      .map(log => `${log.sender === 'BOT' ? 'Bot' : 'User'}: ${log.message}`)
      .reverse()
      .join('\n');

    // Find the last message sent by the bot
    const lastBotLog = logs.find(log => log.sender === 'BOT');
    const lastBotMessage = lastBotLog ? lastBotLog.message : null;

    let pendingAction = null;

    // 2. Query persistent SessionState from database first
    const activeSession = await SessionState.findOne({
      $or: [
        { phoneNumber: senderNumber },
        { phoneNumber: cleanSender }
      ]
    });

    if (activeSession && activeSession.pendingAction) {
      pendingAction = activeSession.pendingAction;
      console.log(`[contextBuilder] SessionState found: "${pendingAction}"`);
    } else if (lastBotMessage) {
      // Fallback: Infer from last bot message if no DB session is active
      const msgLower = lastBotMessage.toLowerCase();
      if (msgLower.includes('yes manage') || msgLower.includes('no replan')) {
        pendingAction = 'awaiting_manage_decision';
      } else if (msgLower.includes("reply when you're up")) {
        pendingAction = 'awaiting_wake_up_reply';
      } else if (msgLower.includes('when should i remind you')) {
        pendingAction = 'awaiting_missing_datetime';
      } else if (msgLower.includes('what is the deadline')) {
        pendingAction = 'awaiting_missing_datetime';
      }
      console.log(`[contextBuilder] SessionState empty. Inferred pendingAction from bot history: "${pendingAction || 'none'}"`);
    }

    return {
      senderNumber,
      recentConversation,
      lastBotMessage,
      pendingAction,
      currentDateTime: new Date(),
      timezone: 'Asia/Kolkata' // Default relative parsing timezone
    };

  } catch (error) {
    console.error('[contextBuilder] Failed to build context:', error.message);
    return {
      senderNumber,
      recentConversation: '',
      lastBotMessage: null,
      pendingAction: null,
      currentDateTime: new Date(),
      timezone: 'Asia/Kolkata'
    };
  }
}

module.exports = {
  buildContext
};
