require('dotenv').config();
const connectDB = require('../config/db');
const { handleIncomingMessage } = require('../services/whatsappService');
const Task = require('../models/Task');
const SessionState = require('../models/SessionState');

async function testWhatsappService() {
  await connectDB();

  const senderNumber = 'whatsapp:+919999999999';

  // Clear existing tasks and sessions for the test user
  await Task.deleteMany({ phoneNumber: senderNumber });
  await SessionState.deleteMany({ phoneNumber: senderNumber });

  console.log('\n--- Test 1: Add task prepare pitch deck high priority ---');
  let result = await handleIncomingMessage('add task prepare pitch deck high priority', senderNumber);
  console.log('Result:', JSON.stringify(result, null, 2));

  // Check if task was created in DB
  const task = await Task.findOne({ phoneNumber: senderNumber });
  console.log('Created Task in DB:', task ? task.title : 'None');

  console.log('\n--- Test 2: Wake up reply when no tasks missed ---');
  result = await handleIncomingMessage("I'm up", senderNumber);
  console.log('Result:', JSON.stringify(result, null, 2));

  console.log('\n--- Test 3: Wake up reply when there are missed tasks ---');
  // Create a task that was scheduled in the past today
  const pastTimeStart = new Date();
  pastTimeStart.setHours(pastTimeStart.getHours() - 3);
  const pastTimeEnd = new Date();
  pastTimeEnd.setHours(pastTimeEnd.getHours() - 2);

  await Task.create({
    phoneNumber: senderNumber,
    title: 'Missed Morning Status Call',
    status: 'pending',
    priority: 'high',
    scheduledStart: pastTimeStart,
    scheduledEnd: pastTimeEnd,
    dueDate: new Date()
  });

  result = await handleIncomingMessage("I'm up", senderNumber);
  console.log('Result:', JSON.stringify(result, null, 2));

  // Check if session state is awaiting_manage_decision
  const session = await SessionState.findOne({ phoneNumber: senderNumber });
  console.log('Session pendingAction:', session ? session.pendingAction : 'None');

  console.log('\n--- Test 4: Can manage reply ---');
  result = await handleIncomingMessage("yes, I can manage", senderNumber);
  console.log('Result:', JSON.stringify(result, null, 2));

  console.log('\n--- Test 5: I can\'t manage replan my day ---');
  result = await handleIncomingMessage("I can't manage replan my day", senderNumber);
  console.log('Result:', JSON.stringify(result, null, 2));
}

testWhatsappService()
  .then(() => {
    console.log('\n✅ All WhatsApp service integration tests finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Integration test failed:', err);
    process.exit(1);
  });
