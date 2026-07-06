require('dotenv').config();
const connectDB = require('../config/db');
const {
  startScheduler,
  stopScheduler,
  getAgenda,
  refreshRemindersForUser,
  jobHandlers
} = require('../services/schedulerService');
const User = require('../models/User');
const Task = require('../models/Task');
const Event = require('../models/Event');
const SessionState = require('../models/SessionState');
const ConversationLog = require('../models/ConversationLog');

async function run() {
  await connectDB();

  const phone = 'whatsapp:+912222222222';
  await Promise.all([
    User.deleteMany({ phoneNumber: phone }),
    Task.deleteMany({ phoneNumber: phone }),
    Event.deleteMany({ phoneNumber: phone }),
    SessionState.deleteMany({ phoneNumber: phone }),
    ConversationLog.deleteMany({})
  ]);
  await User.create({ phoneNumber: phone });

  const results = {};
  const check = (name, ok, detail) => {
    results[name] = ok;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + detail}`);
  };

  await startScheduler();
  const agenda = getAgenda();
  check('scheduler starts', Boolean(agenda));

  const recurring = await agenda.queryJobs({});
  const names = recurring.jobs.map((j) => j.name);
  check(
    'recurring jobs registered',
    ['morning-quote', 'schedule-today-reminders', 'evening-review', 'deal-followups']
      .every((n) => names.includes(n)),
    `found: ${names.join(', ')}`
  );

  // --- morning quote sets wake-up FSM state ---
  await jobHandlers.morningQuote();
  const session = await SessionState.findOne({ phoneNumber: phone });
  check(
    'morning quote sets awaiting_wake_up_reply',
    session && session.pendingAction === 'awaiting_wake_up_reply',
    JSON.stringify(session)
  );
  const quoteLog = await ConversationLog.findOne({ detectedIntent: 'morning_quote' });
  check('morning quote logged to conversation', Boolean(quoteLog));

  // --- T-5 reminders scheduled for upcoming items ---
  const in2h = new Date(Date.now() + 2 * 3600000);
  const task = await Task.create({
    phoneNumber: phone,
    title: 'Investor call prep',
    scheduledStart: in2h,
    scheduledEnd: new Date(in2h.getTime() + 3600000),
    priority: 'high'
  });
  // Protected block must NOT get a reminder
  await Event.create({
    phoneNumber: phone,
    title: 'Deep work',
    startTime: new Date(Date.now() + 4 * 3600000),
    endTime: new Date(Date.now() + 5 * 3600000),
    notes: 'PROTECTED_BLOCK: no reminders, immovable'
  });

  const refresh = await refreshRemindersForUser(phone);
  check('reminder scheduled for task only', refresh.scheduled === 1, JSON.stringify(refresh));

  const reminderJobs = await agenda.queryJobs({ name: 'task-reminder', data: { phoneNumber: phone } });
  const expectedFireAt = in2h.getTime() - 5 * 60000;
  check(
    'reminder fires at T-5',
    reminderJobs.jobs.length === 1 &&
      Math.abs(new Date(reminderJobs.jobs[0].nextRunAt).getTime() - expectedFireAt) < 2000,
    JSON.stringify(reminderJobs.jobs.map((j) => j.nextRunAt))
  );

  // --- stale reminder self-skips after task moves ---
  task.scheduledStart = new Date(Date.now() + 6 * 3600000);
  task.scheduledEnd = new Date(Date.now() + 7 * 3600000);
  await task.save();
  const logsBefore = await ConversationLog.countDocuments({ detectedIntent: 'task_reminder' });
  await jobHandlers.taskReminder({
    phoneNumber: phone,
    refType: 'task',
    refId: task._id.toString(),
    expectedStart: in2h.toISOString() // old time -> stale
  });
  const logsAfter = await ConversationLog.countDocuments({ detectedIntent: 'task_reminder' });
  check('stale reminder skips silently', logsAfter === logsBefore);

  // --- valid reminder sends ---
  await jobHandlers.taskReminder({
    phoneNumber: phone,
    refType: 'task',
    refId: task._id.toString(),
    expectedStart: task.scheduledStart.toISOString()
  });
  const logsValid = await ConversationLog.countDocuments({ detectedIntent: 'task_reminder' });
  check('valid reminder sends', logsValid === logsBefore + 1);

  // --- DND suppresses proactive sends ---
  await SessionState.findOneAndUpdate(
    { phoneNumber: phone },
    { dndUntil: new Date(Date.now() + 3600000) }
  );
  await jobHandlers.taskReminder({
    phoneNumber: phone,
    refType: 'task',
    refId: task._id.toString(),
    expectedStart: task.scheduledStart.toISOString()
  });
  const logsDnd = await ConversationLog.countDocuments({ detectedIntent: 'task_reminder' });
  check('DND suppresses reminder', logsDnd === logsValid);
  await SessionState.findOneAndUpdate({ phoneNumber: phone }, { dndUntil: null });

  // --- evening review composes and sends ---
  await jobHandlers.eveningReview();
  const reviewLog = await ConversationLog.findOne({ detectedIntent: 'evening_review' });
  check('evening review sends', Boolean(reviewLog), 'no log found');

  // --- deal followups silent when clean ---
  const followupsBefore = await ConversationLog.countDocuments({ detectedIntent: 'deal_followups' });
  await jobHandlers.dealFollowups();
  const followupsAfter = await ConversationLog.countDocuments({ detectedIntent: 'deal_followups' });
  check('followups silent when nothing due', followupsAfter === followupsBefore);

  await stopScheduler();

  const failed = Object.entries(results).filter(([, ok]) => !ok);
  console.log(`\n${Object.keys(results).length - failed.length}/${Object.keys(results).length} passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
