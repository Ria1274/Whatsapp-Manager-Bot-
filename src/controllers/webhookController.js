const { handleIncomingMessage } = require('../services/whatsappService');

// Verify Webhook for Meta (if ever needed again)
const verifyWebhook = (req, res) => {
  res.status(200).send('Webhook endpoint is active.');
};

// Helper to escape XML characters
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Receive incoming messages
const receiveMessage = async (req, res, next) => {
  try {
    let text = req.body.Body || req.body.text || '';
    const sender = req.body.From || req.body.sender || 'Unknown';
    let transcriptionNotice = '';

    // Check for Twilio audio media attachments (voice notes)
    const numMedia = parseInt(req.body.NumMedia || 0, 10);
    if (numMedia > 0) {
      let audioUrl = null;
      for (let i = 0; i < numMedia; i++) {
        const contentType = req.body[`MediaContentType${i}`] || '';
        if (contentType.startsWith('audio/')) {
          audioUrl = req.body[`MediaUrl${i}`];
          break;
        }
      }

      if (audioUrl) {
        try {
          const { transcribeAudio } = require('../services/transcriptionService');
          const transcribedText = await transcribeAudio(audioUrl);
          if (transcribedText) {
            text = transcribedText;
            transcriptionNotice = `🎤 _Transcribed: "${transcribedText}"_\n\n`;
          }
        } catch (transcriptionError) {
          console.error('[webhookController] Transcription error:', transcriptionError.message);
          transcriptionNotice = `⚠️ _[Voice note detected, but transcription failed: ${transcriptionError.message}]_\n\n`;
        }
      }
    }

    // Get the NLP response
    const result = await handleIncomingMessage(text, sender);
    const replyText = result.responseText || 'Got it.';
    const finalResponseText = transcriptionNotice + replyText;

    // Check if the request is from Twilio
    const isTwilioRequest = !!(req.body.AccountSid || req.body.MessageSid);

    if (isTwilioRequest) {
      res.setHeader('Content-Type', 'text/xml');
      const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(finalResponseText)}</Message>
</Response>`;
      return res.status(200).send(xmlResponse);
    } else {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(finalResponseText);
    }

  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyWebhook,
  receiveMessage,
};
