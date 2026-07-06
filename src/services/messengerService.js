const { realSendWhatsAppMessage } = require('./whatsappService');

// Outbound WhatsApp transport. Twilio REST when credentials exist
// (sandbox-compatible), otherwise the Meta/mock sender from whatsappService.

let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

function hasTwilioCreds() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')
  );
}

function toWhatsAppAddress(number) {
  const clean = String(number).trim();
  return clean.startsWith('whatsapp:') ? clean : `whatsapp:${clean}`;
}

/**
 * Send an outbound WhatsApp message (proactive, outside a webhook reply).
 *
 * @param {string} to - Recipient number, with or without the whatsapp: prefix
 * @param {string} body - Message text
 * @returns {Promise<boolean>} true if handed to a transport without error
 */
async function sendMessage(to, body) {
  if (hasTwilioCreds()) {
    try {
      const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
      await getTwilioClient().messages.create({
        from: toWhatsAppAddress(from),
        to: toWhatsAppAddress(to),
        body
      });
      console.log(`✅ Twilio WhatsApp message sent to ${to}`);
      return true;
    } catch (err) {
      console.error('❌ Twilio send failed:', err.message);
      return false;
    }
  }

  // Falls back to Meta sender, which mock-logs when unconfigured
  return realSendWhatsAppMessage(to.replace('whatsapp:', ''), body);
}

module.exports = {
  sendMessage
};
