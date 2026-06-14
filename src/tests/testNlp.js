require('dotenv').config();
const { processMessage } = require('../nlp/processMessage');
const connectDB = require('../config/db');

async function runTests() {
  // Connect to DB
  await connectDB();

  const senderNumber = 'whatsapp:+919999999999';

  const tests = [
    "I'm up",
    "remind me to call Sumeet tomorrow at 4pm",
    "kal client meeting hai 11 baje, 1 hour prep chahiye",
    "I can't manage replan my day",
    "what is my plan today",
    "I want to lose 12 kg by August",
    "add task prepare pitch deck high priority"
  ];

  for (const text of tests) {
    console.log('\n==============================');
    console.log('USER:', text);

    const result = await processMessage(text, senderNumber);

    console.log('RESULT:', JSON.stringify(result, null, 2));
  }
}

runTests().catch(console.error);
