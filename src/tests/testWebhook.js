require('dotenv').config();
const connectDB = require('../config/db');
const { receiveMessage } = require('../controllers/webhookController');
const Task = require('../models/Task');
const SessionState = require('../models/SessionState');

// Simple mock request and response builders
class MockResponse {
  constructor() {
    this.headers = {};
    this.statusCode = 200;
    this.body = '';
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  send(body) {
    this.body = body;
    return this;
  }
}

async function runWebhookTests() {
  await connectDB();

  const senderNumber = 'whatsapp:+919999999999';

  // Reset DB entries for the test user
  await Task.deleteMany({ phoneNumber: senderNumber });
  await SessionState.deleteMany({ phoneNumber: senderNumber });

  console.log('\n==================================================');
  console.log('🤖 Running Webhook & Voice Transcription Tests...');
  console.log('==================================================');

  // --- Test 1: Standard URL-Encoded Twilio SMS/WhatsApp Text Message ---
  console.log('\n--- Test 1: Incoming SMS Text Message (TwiML expected) ---');
  const req1 = {
    body: {
      Body: 'list tasks',
      From: senderNumber,
      AccountSid: 'ACabc123xyz' // Mock Twilio Account SID
    }
  };
  const res1 = new MockResponse();

  await receiveMessage(req1, res1, (err) => console.error('Next middleware called:', err));

  console.log('Response Status:', res1.statusCode);
  console.log('Response Headers:', JSON.stringify(res1.headers, null, 2));
  console.log('Response XML TwiML:\n', res1.body);

  // --- Test 2: Standard JSON / API Request (Plain Text expected) ---
  console.log('\n--- Test 2: Standard API request (Plain text expected) ---');
  const req2 = {
    body: {
      text: 'list tasks',
      sender: senderNumber
    }
  };
  const res2 = new MockResponse();

  await receiveMessage(req2, res2, (err) => console.error('Next middleware called:', err));

  console.log('Response Status:', res2.statusCode);
  console.log('Response Headers:', JSON.stringify(res2.headers, null, 2));
  console.log('Response Body:\n', res2.body);

  // --- Test 3: Audio Voice Note Request (Whisper fails gracefully due to mock/quota, falling back) ---
  console.log('\n--- Test 3: Audio Voice Note Request from Twilio ---');
  const req3 = {
    body: {
      From: senderNumber,
      AccountSid: 'ACabc123xyz',
      NumMedia: '1',
      MediaContentType0: 'audio/ogg',
      MediaUrl0: 'https://demo.twilio.com/docs/classic.mp3' // public demo audio file
    }
  };
  const res3 = new MockResponse();

  console.log('Sending voice note. Webhook should download, attempt transcription, and respond...');
  await receiveMessage(req3, res3, (err) => console.error('Next middleware called:', err));

  console.log('Response Status:', res3.statusCode);
  console.log('Response XML TwiML Response:\n', res3.body);
}

runWebhookTests()
  .then(() => {
    console.log('\n✅ All webhook tests finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Webhook test failed:', err);
    process.exit(1);
  });
