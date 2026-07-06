const { Agenda } = require('agenda');
const { MongoBackend } = require('@agendajs/mongo-backend');
const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const Event = require('../models/Event');
const SessionState = require('../models/SessionState');
const ConversationLog = require('../models/ConversationLog');
const { sendMessage } = require('./messengerService');

// Durable job scheduler (Agenda, backed by the existing MongoDB).
// Jobs survive restarts - unlike node-cron - which matters for
// one-off T-minus-5 reminders scheduled hours ahead.

const TZ = 'Asia/Kolkata';
const REMINDER_LEAD_MINUTES = 5;
const START_TOLERANCE_MS = 60 * 1000;

const QUOTES = [
  'Discipline is choosing between what you want now and what you want most.',
  'The way to get started is to quit talking and begin doing.',
  'Focus on being productive instead of busy.',
  'You do not rise to the level of your goals. You fall to the level of your systems.',
  'Amateurs sit and wait for inspiration. The rest of us just get up and go to work.',
  'What gets scheduled gets done.',
  'Small daily improvements are the key to staggering long-term results.',
  'Your future is created by what you do today, not tomorrow.',
  'Do the hard thing first. The rest of the day is downhill.',
  'Energy, not time, is the fundamental currency of high performance.',
  'A goal without a plan is just a wish.',
  'Slow is smooth, smooth is fast.',
  'Action is the antidote to anxiety.',
  'You will never always be motivated. You have to learn to be disciplined.',
  'Protect your mornings like they pay your salary. They do.'
];

let agenda = null;

async function isDndActive(phoneNumber) {
  const session = await SessionState.findOne({ phoneNumber });
  return Boolean(session && session.dndUntil && session.dndUntil > new Date());
}

/** Send a proactive message unless DND, and log it so contextBuilder sees it. */
async function sendProactive(phoneNumber, message, intent) {
  if (await isDndActive(phoneNumber)) {
    console.log(`[scheduler] DND active for ${phoneNumber}, skipping ${intent}`);
    return false;
  }
  await sendMessage(phoneNumber, message);
  await ConversationLog.create({
    message,
    sender: 'BOT',
    detectedIntent: intent,
    responseText: message
  });
  return true;
}

// ------------------------------------------------------------------
// Job handlers (exported for direct testing)
// ------------------------------------------------------------------

const jobHandlers = {

  /** 07:00 IST daily: quote + wake-up check. Sets the FSM to await "good morning". */
  async morningQuote() {
    const users = await User.find();
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const quote = QUOTES[dayOfYear % QUOTES.length];

    for (const user of users) {
      const sent = await sendProactive(
        user.phoneNumber,
        `☀️ "${quote}"\n\nGood morning! Reply when you're up and I'll walk you through today.`,
        'morning_quote'
      );
      if (sent) {
        await SessionState.findOneAndUpdate(
          { phoneNumber: user.phoneNumber },
          {
            pendingAction: 'awaiting_wake_up_reply',
            expiresAt: new Date(Date.now() + 6 * 3600000)
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
    }
  },

  /**
   * One-off T-minus-5 reminder. Self-validating: skips silently if the
   * item was completed, cancelled, or moved since the job was scheduled.
   */
  async taskReminder(data) {
    const { phoneNumber, refType, refId, expectedStart } = data;
    const expected = new Date(expectedStart).getTime();

    let title = null;
    if (refType === 'task') {
      const task = await Task.findOne({ _id: refId, phoneNumber });
      if (
        !task ||
        !['pending', 'in_progress'].includes(task.status) ||
        !task.scheduledStart ||
        Math.abs(task.scheduledStart.getTime() - expected) > START_TOLERANCE_MS
      ) {
        return; // stale reminder - the fresh one was scheduled elsewhere
      }
      title = task.title;
    } else {
      const event = await Event.findOne({ _id: refId, phoneNumber });
      if (!event || Math.abs(event.startTime.getTime() - expected) > START_TOLERANCE_MS) {
        return;
      }
      if ((event.notes || '').includes('PROTECTED_BLOCK')) return; // no nags for deep work
      title = event.title;
    }

    await sendProactive(
      phoneNumber,
      `⏰ *${title}* in ${REMINDER_LEAD_MINUTES} min.\nIf it can't happen, tell me - I'll sort the rest of the day.`,
      'task_reminder'
    );
  },

  /** 00:05 IST daily: (re)build today's one-off reminders for every user. */
  async scheduleTodayReminders() {
    const users = await User.find();
    for (const user of users) {
      await refreshRemindersForUser(user.phoneNumber);
    }
  },

  /** 21:30 IST daily: evening review - done, slipped, tomorrow preview. */
  async eveningReview() {
    const { handlers } = require('../agent/dispatcher');
    const users = await User.find();

    for (const user of users) {
      const ctx = { phoneNumber: user.phoneNumber, now: new Date() };
      const review = await handlers.evening_review({}, ctx);

      const parts = ['🌙 *Day wrap-up*'];
      parts.push(review.completed.length
        ? `Done: ${review.completed.join(', ')}`
        : 'Nothing marked done today.');
      if (review.slipped.length) parts.push(`Slipped: ${review.slipped.join(', ')}`);
      if (review.deferred.length) parts.push(`Parked: ${review.deferred.join(', ')}`);

      const tomorrowCount = review.tomorrow.events.length + review.tomorrow.tasks.length;
      parts.push(tomorrowCount
        ? `Tomorrow: ${tomorrowCount} item(s) on the board. First up: ${(review.tomorrow.events[0] || review.tomorrow.tasks[0]).title}.`
        : 'Tomorrow is wide open so far.');
      parts.push('How did today feel?');

      await sendProactive(user.phoneNumber, parts.join('\n'), 'evening_review');
    }
  },

  /** 10:00 IST daily: overdue promises and stale deals. Silent when clean. */
  async dealFollowups() {
    const { handlers } = require('../agent/dispatcher');
    const users = await User.find();

    for (const user of users) {
      const ctx = { phoneNumber: user.phoneNumber, now: new Date() };
      const f = await handlers.due_followups({}, ctx);

      const lines = [];
      for (const p of f.overduePromises) {
        lines.push(p.direction === 'owed_by_me'
          ? `🔴 You owe ${p.who}: ${p.what} (overdue)`
          : `🔴 ${p.who} owes you: ${p.what} (overdue)`);
      }
      for (const d of f.staleDeals) {
        lines.push(`🟡 ${d.clientName} (${d.status}) - quiet for ${d.daysSinceTouch} days`);
      }

      if (lines.length) {
        await sendProactive(
          user.phoneNumber,
          `📋 *Follow-ups needing you:*\n${lines.join('\n')}`,
          'deal_followups'
        );
      }
    }
  }
};

// ------------------------------------------------------------------
// Reminder management
// ------------------------------------------------------------------

/**
 * Rebuild all pending T-minus-5 reminders for one user from current DB
 * state. Cancels this user's future reminder jobs first, so it is safe
 * to call after any replan/move. No-op if the scheduler is not running.
 */
async function refreshRemindersForUser(phoneNumber) {
  if (!agenda) return { scheduled: 0, skipped: 'scheduler not running' };

  // Rolling 24h window: the daily 00:05 job re-runs this with cancel-first,
  // so items further out get picked up on their own day.
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 24 * 3600000);

  // Cancels every reminder job for this user; already-fired ones are
  // just stale documents, and fresh jobs are recreated below.
  await agenda.cancel({
    name: 'task-reminder',
    data: { phoneNumber }
  });

  const tasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    scheduledStart: { $gt: now, $lte: horizonEnd }
  });
  const events = await Event.find({
    phoneNumber,
    startTime: { $gt: now, $lte: horizonEnd },
    notes: { $not: /PROTECTED_BLOCK/ }
  });

  let scheduled = 0;
  const items = [
    ...tasks.map((t) => ({ refType: 'task', refId: t._id.toString(), start: t.scheduledStart })),
    ...events.map((e) => ({ refType: 'event', refId: e._id.toString(), start: e.startTime }))
  ];

  for (const item of items) {
    const remindAt = new Date(item.start.getTime() - REMINDER_LEAD_MINUTES * 60000);
    if (remindAt <= now) continue;
    await agenda.schedule(remindAt, 'task-reminder', {
      phoneNumber,
      refType: item.refType,
      refId: item.refId,
      expectedStart: item.start.toISOString()
    });
    scheduled++;
  }

  return { scheduled };
}

// ------------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------------

/** Start the scheduler. Call after connectDB(). */
async function startScheduler() {
  agenda = new Agenda({
    backend: new MongoBackend({ mongo: mongoose.connection.db }),
    processEvery: '30 seconds'
  });

  agenda.define('morning-quote', async () => jobHandlers.morningQuote());
  agenda.define('task-reminder', async (job) => jobHandlers.taskReminder(job.attrs.data));
  agenda.define('schedule-today-reminders', async () => jobHandlers.scheduleTodayReminders());
  agenda.define('evening-review', async () => jobHandlers.eveningReview());
  agenda.define('deal-followups', async () => jobHandlers.dealFollowups());

  await agenda.start();

  await agenda.every('0 7 * * *', 'morning-quote', {}, { timezone: TZ });
  await agenda.every('5 0 * * *', 'schedule-today-reminders', {}, { timezone: TZ });
  await agenda.every('30 21 * * *', 'evening-review', {}, { timezone: TZ });
  await agenda.every('0 10 * * *', 'deal-followups', {}, { timezone: TZ });

  // Cover the rest of today after a restart
  await jobHandlers.scheduleTodayReminders();

  console.log('🕒 Agenda scheduler started: morning-quote 07:00, followups 10:00, review 21:30, reminders T-5 (IST)');
  return agenda;
}

async function stopScheduler() {
  if (agenda) {
    await agenda.stop();
    agenda = null;
  }
}

function getAgenda() {
  return agenda;
}

module.exports = {
  startScheduler,
  stopScheduler,
  getAgenda,
  refreshRemindersForUser,
  jobHandlers,
  QUOTES
};
