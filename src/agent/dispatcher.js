const mongoose = require('mongoose');
const Task = require('../models/Task');
const Event = require('../models/Event');
const SessionState = require('../models/SessionState');
const Contact = require('../models/Contact');
const Deal = require('../models/Deal');
const Commitment = require('../models/Commitment');
const MemoryFact = require('../models/MemoryFact');
const ConversationLog = require('../models/ConversationLog');
const rescheduleService = require('../services/rescheduleService');
const { ESCALATION_POLICY } = require('./tools');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const DAY_START_HOUR = 9;
const DAY_END_HOUR = 22;

// Maps agent life domains onto the legacy Task/Event category enum
const DOMAIN_TO_CATEGORY = {
  startup: 'startup',
  health: 'health',
  family: 'social',
  friends: 'social',
  errands: 'other',
  learning: 'academic',
  personal: 'personal'
};

// Maps elasticity onto the legacy scheduling flags so the existing
// rescheduler keeps working without changes
const ELASTICITY_FLAGS = {
  fixed: { isFixedTime: true, canBeRescheduled: false, canBeSkipped: false },
  movable_today: { isFixedTime: false, canBeRescheduled: true, canBeSkipped: false },
  movable_this_week: { isFixedTime: false, canBeRescheduled: true, canBeSkipped: false },
  droppable: { isFixedTime: false, canBeRescheduled: true, canBeSkipped: true }
};

function dayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rebuild T-minus-5 reminder jobs after a schedule mutation.
 * Lazy-required to avoid a load-time cycle; no-op when the scheduler
 * is not running (tests, legacy mode).
 */
async function refreshReminders(phoneNumber) {
  try {
    const { refreshRemindersForUser } = require('../services/schedulerService');
    await refreshRemindersForUser(phoneNumber);
  } catch (err) {
    console.error('[dispatcher] reminder refresh skipped:', err.message);
  }
}

/**
 * Resolve a task/event reference that may be a Mongo id or a title fragment.
 * Returns { kind: 'task'|'event', doc } or null.
 */
async function findByRef(phoneNumber, ref) {
  if (mongoose.Types.ObjectId.isValid(ref)) {
    const task = await Task.findOne({ _id: ref, phoneNumber });
    if (task) return { kind: 'task', doc: task };
    const event = await Event.findOne({ _id: ref, phoneNumber });
    if (event) return { kind: 'event', doc: event };
  }

  const titleRegex = { $regex: escapeRegex(ref), $options: 'i' };
  const task = await Task.findOne({
    phoneNumber,
    title: titleRegex,
    status: { $in: ['pending', 'in_progress'] }
  }).sort({ scheduledStart: 1 });
  if (task) return { kind: 'task', doc: task };

  const event = await Event.findOne({
    phoneNumber,
    title: titleRegex,
    endTime: { $gte: new Date() }
  }).sort({ startTime: 1 });
  if (event) return { kind: 'event', doc: event };

  return null;
}

function taskSummary(t) {
  return {
    id: t._id.toString(),
    type: 'task',
    title: t.title,
    priority: t.priority,
    domain: t.domain,
    elasticity: t.elasticity,
    status: t.status,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    dueDate: t.dueDate,
    durationMinutes: t.estimatedDurationMinutes
  };
}

function eventSummary(e) {
  return {
    id: e._id.toString(),
    type: 'event',
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    location: e.location || null,
    notes: e.notes || null
  };
}

/** Merged busy intervals (events + time-blocked tasks) for one day. */
async function busyIntervalsForDay(phoneNumber, date) {
  const { start, end } = dayRange(date);

  const events = await Event.find({
    phoneNumber,
    startTime: { $lte: end },
    endTime: { $gte: start }
  });

  const scheduledTasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    scheduledStart: { $lte: end },
    scheduledEnd: { $gte: start }
  });

  const intervals = [
    ...events.map((e) => ({ start: e.startTime.getTime(), end: e.endTime.getTime(), title: e.title })),
    ...scheduledTasks.map((t) => ({
      start: t.scheduledStart.getTime(),
      end: t.scheduledEnd.getTime() + (t.bufferMinutes || 0) * 60000,
      title: t.title
    }))
  ].sort((a, b) => a.start - b.start);

  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** First free gap of `durationMinutes` on `date` within working hours, not before `notBefore`. */
async function findFreeSlotOnDay(phoneNumber, date, durationMinutes, notBefore) {
  const busy = await busyIntervalsForDay(phoneNumber, date);
  const durationMs = durationMinutes * 60000;

  const dayStart = new Date(date);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  let cursor = Math.max(dayStart.getTime(), notBefore ? notBefore.getTime() : 0);

  for (const iv of busy) {
    if (iv.start - cursor >= durationMs && cursor + durationMs <= dayEnd.getTime()) {
      return { start: new Date(cursor), end: new Date(cursor + durationMs) };
    }
    cursor = Math.max(cursor, iv.end);
  }

  if (cursor + durationMs <= dayEnd.getTime()) {
    return { start: new Date(cursor), end: new Date(cursor + durationMs) };
  }
  return null;
}

// ------------------------------------------------------------------
// Tool executors. Each receives (args, ctx) where ctx = { phoneNumber, now }.
// Return values are JSON-serializable and fed back to the LLM.
// ------------------------------------------------------------------

const handlers = {

  // ---- Core scheduling ------------------------------------------

  async create_task(args, ctx) {
    const flags = ELASTICITY_FLAGS[args.elasticity] || ELASTICITY_FLAGS.movable_today;
    const duration = args.durationMinutes || 30;

    let scheduledStart = args.preferredStart ? new Date(args.preferredStart) : null;
    let scheduledEnd = scheduledStart ? new Date(scheduledStart.getTime() + duration * 60000) : null;

    const task = await Task.create({
      phoneNumber: ctx.phoneNumber,
      title: args.title,
      domain: args.domain,
      elasticity: args.elasticity,
      category: DOMAIN_TO_CATEGORY[args.domain] || 'other',
      estimatedDurationMinutes: duration,
      dueDate: args.deadline ? new Date(args.deadline) : null,
      scheduledStart,
      scheduledEnd,
      notes: args.notes || '',
      priority: args.domain === 'startup' ? 'high' : 'medium',
      source: 'whatsapp',
      ...flags
    });
    if (scheduledStart) await refreshReminders(ctx.phoneNumber);
    return { created: taskSummary(task) };
  },

  async create_event(args, ctx) {
    const notes = args.relatedPerson ? `Related Person: ${args.relatedPerson}` : '';
    const event = await Event.create({
      phoneNumber: ctx.phoneNumber,
      title: args.title,
      startTime: new Date(args.start),
      endTime: new Date(args.end),
      location: args.location || '',
      isMovable: false,
      source: 'whatsapp',
      notes
    });
    if (args.relatedPerson) {
      await Contact.findOneAndUpdate(
        { phoneNumber: ctx.phoneNumber, name: args.relatedPerson },
        { $set: { lastMentionedAt: ctx.now } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    await refreshReminders(ctx.phoneNumber);
    return { created: eventSummary(event) };
  },

  async move_task(args, ctx) {
    const found = await findByRef(ctx.phoneNumber, args.ref);
    if (!found) return { error: `Nothing found matching "${args.ref}".` };

    const newStart = new Date(args.newStart);
    if (found.kind === 'task') {
      const t = found.doc;
      const duration = (t.estimatedDurationMinutes || 30) * 60000;
      t.scheduledStart = newStart;
      t.scheduledEnd = new Date(newStart.getTime() + duration);
      t.notes = `${t.notes ? t.notes + '\n' : ''}MOVED: ${args.reason}`;
      await t.save();
      await refreshReminders(ctx.phoneNumber);
      return { moved: taskSummary(t) };
    }

    const e = found.doc;
    const duration = e.endTime.getTime() - e.startTime.getTime();
    e.startTime = newStart;
    e.endTime = new Date(newStart.getTime() + duration);
    e.notes = `${e.notes ? e.notes + '\n' : ''}MOVED: ${args.reason}`;
    await e.save();
    await refreshReminders(ctx.phoneNumber);
    return { moved: eventSummary(e) };
  },

  async cancel_task(args, ctx) {
    const found = await findByRef(ctx.phoneNumber, args.ref);
    if (!found) return { error: `Nothing found matching "${args.ref}".` };

    if (found.kind === 'task') {
      found.doc.status = 'cancelled';
      found.doc.notes = `${found.doc.notes ? found.doc.notes + '\n' : ''}CANCELLED: ${args.reason}`;
      await found.doc.save();
      return { cancelled: taskSummary(found.doc) };
    }

    const involvesPerson = (found.doc.notes || '').includes('Related Person:');
    await Event.deleteOne({ _id: found.doc._id });
    return {
      cancelled: eventSummary(found.doc),
      involvedAnotherPerson: involvesPerson,
      hint: involvesPerson ? 'This event involved another person - the user may want to inform them.' : null
    };
  },

  async complete_task(args, ctx) {
    const found = await findByRef(ctx.phoneNumber, args.ref);
    if (!found) return { error: `Nothing found matching "${args.ref}".` };
    if (found.kind === 'event') {
      return { info: 'Events do not get completed; only tasks do.', event: eventSummary(found.doc) };
    }
    found.doc.status = 'completed';
    await found.doc.save();
    return { completed: taskSummary(found.doc) };
  },

  // ---- Anticipation ----------------------------------------------

  async get_briefing(args, ctx) {
    const now = ctx.now;
    let rangeStart;
    let rangeEnd;

    if (args.scope === 'today') {
      ({ start: rangeStart, end: rangeEnd } = dayRange(now));
    } else if (args.scope === 'tomorrow') {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      ({ start: rangeStart, end: rangeEnd } = dayRange(t));
    } else {
      rangeStart = dayRange(now).start;
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + (args.scope === 'week' ? 7 : 30));
    }

    const events = await Event.find({
      phoneNumber: ctx.phoneNumber,
      startTime: { $lte: rangeEnd },
      endTime: { $gte: rangeStart }
    }).sort({ startTime: 1 });

    const tasks = await Task.find({
      phoneNumber: ctx.phoneNumber,
      status: { $in: ['pending', 'in_progress'] },
      $or: [
        { scheduledStart: { $gte: rangeStart, $lte: rangeEnd } },
        { dueDate: { $gte: rangeStart, $lte: rangeEnd } },
        { scheduledStart: null, dueDate: null }
      ]
    }).sort({ scheduledStart: 1, dueDate: 1 });

    const dnd = await SessionState.findOne({ phoneNumber: ctx.phoneNumber });

    // Pulling the briefing is the wake-up acknowledgment in agent mode
    if (dnd && dnd.pendingAction === 'awaiting_wake_up_reply') {
      dnd.pendingAction = null;
      await dnd.save();
    }

    return {
      scope: args.scope,
      events: events.map(eventSummary),
      tasks: tasks.map(taskSummary),
      dndUntil: dnd && dnd.dndUntil && dnd.dndUntil > now ? dnd.dndUntil : null
    };
  },

  async prep_brief(args, ctx) {
    const found = await findByRef(ctx.phoneNumber, args.eventRef);
    if (!found || found.kind !== 'event') {
      return { error: `No upcoming event found matching "${args.eventRef}".` };
    }
    const event = found.doc;

    const personMatch = (event.notes || '').match(/Related Person:\s*(.+)/i);
    const personName = personMatch ? personMatch[1].trim() : null;

    let contact = null;
    let deals = [];
    let promises = [];
    let recentMentions = [];

    if (personName) {
      const nameRegex = { $regex: escapeRegex(personName), $options: 'i' };
      contact = await Contact.findOne({ phoneNumber: ctx.phoneNumber, name: nameRegex });
      deals = await Deal.find({ phoneNumber: ctx.phoneNumber, clientName: nameRegex });
      promises = await Commitment.find({ phoneNumber: ctx.phoneNumber, who: nameRegex, status: 'open' });
      recentMentions = await ConversationLog.find({ message: nameRegex })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('message sender createdAt');
    }

    return {
      event: eventSummary(event),
      person: personName,
      contact: contact ? { name: contact.name, role: contact.role, company: contact.company, notes: contact.notes } : null,
      deals: deals.map((d) => ({
        clientName: d.clientName,
        status: d.status,
        latestNote: d.notes.length ? d.notes[0].text : null
      })),
      openPromises: promises.map((p) => ({ direction: p.direction, what: p.what, due: p.due })),
      recentMentions: recentMentions.map((m) => `${m.sender === 'BOT' ? 'Bot' : 'User'}: ${m.message}`)
    };
  },

  async scan_conflicts(args, ctx) {
    const horizon = Math.min(args.horizonDays || 7, 31);
    const findings = [];

    for (let i = 0; i < horizon; i++) {
      const day = new Date(ctx.now);
      day.setDate(day.getDate() + i);
      const busy = await busyIntervalsForDay(ctx.phoneNumber, day);

      const { start, end } = dayRange(day);
      const events = await Event.find({
        phoneNumber: ctx.phoneNumber,
        startTime: { $lte: end },
        endTime: { $gte: start }
      }).sort({ startTime: 1 });

      for (let j = 1; j < events.length; j++) {
        if (events[j].startTime < events[j - 1].endTime) {
          findings.push({
            date: start.toDateString(),
            type: 'overlap',
            detail: `"${events[j - 1].title}" overlaps "${events[j].title}"`
          });
        }
      }

      const busyHours = busy.reduce((sum, iv) => sum + (iv.end - iv.start), 0) / 3600000;
      if (busyHours > 9) {
        findings.push({
          date: start.toDateString(),
          type: 'overload',
          detail: `${busyHours.toFixed(1)} hours scheduled`
        });
      }
    }

    return { horizonDays: horizon, conflicts: findings };
  },

  async suggest_slot(args, ctx) {
    const deadline = args.deadline ? new Date(args.deadline) : null;
    const maxDays = 14;

    for (let i = 0; i < maxDays; i++) {
      const day = new Date(ctx.now);
      day.setDate(day.getDate() + i);
      if (deadline && dayRange(day).start > deadline) break;

      const notBefore = i === 0 ? new Date(ctx.now.getTime() + 10 * 60000) : null;
      const slot = await findFreeSlotOnDay(ctx.phoneNumber, day, args.durationMinutes, notBefore);
      if (slot) {
        return { slot: { start: slot.start, end: slot.end }, domain: args.domain };
      }
    }
    return { slot: null, info: 'No free slot found in the next two weeks within working hours.' };
  },

  // ---- Discretion -------------------------------------------------

  async absorb_delay(args, ctx) {
    const delayEnd = new Date(ctx.now.getTime() + args.minutes * 60000);

    // Fixed commitments that collide with the delay window
    const affectedEvents = await Event.find({
      phoneNumber: ctx.phoneNumber,
      startTime: { $lt: delayEnd },
      endTime: { $gte: ctx.now }
    });
    const affectedFixedTasks = await Task.find({
      phoneNumber: ctx.phoneNumber,
      status: { $in: ['pending', 'in_progress'] },
      $or: [{ isFixedTime: true }, { canBeRescheduled: false }],
      scheduledStart: { $lt: delayEnd },
      scheduledEnd: { $gte: ctx.now }
    });

    const affectedFixed = [
      ...affectedEvents.map(eventSummary),
      ...affectedFixedTasks.map(taskSummary)
    ];

    const result = await rescheduleService.rescheduleDay(ctx.phoneNumber);
    await refreshReminders(ctx.phoneNumber);

    const silent =
      args.minutes <= ESCALATION_POLICY.silentShiftMaxMinutes && affectedFixed.length === 0;

    return {
      silent,
      delayMinutes: args.minutes,
      affectedFixed,
      replanSummary: result.message,
      guidance: silent
        ? 'Silent absorption: acknowledge in at most a few words, or not at all. Do not list changes.'
        : 'Something fixed is affected: tell the user what matters, briefly.'
    };
  },

  async escalate(args, ctx) {
    await MemoryFact.create({
      phoneNumber: ctx.phoneNumber,
      fact: `ESCALATION [${args.severity}]: ${args.message}`,
      category: 'other'
    });
    return { recorded: true, severity: args.severity };
  },

  // ---- Time protection ---------------------------------------------

  async protect_block(args, ctx) {
    const event = await Event.create({
      phoneNumber: ctx.phoneNumber,
      title: args.label,
      category: 'work',
      startTime: new Date(args.start),
      endTime: new Date(args.end),
      isMovable: false,
      source: 'system',
      notes: 'PROTECTED_BLOCK: no reminders, immovable'
    });
    return { protected: eventSummary(event) };
  },

  async set_dnd(args, ctx) {
    await SessionState.findOneAndUpdate(
      { phoneNumber: ctx.phoneNumber },
      { dndUntil: new Date(args.until) },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return { dndUntil: args.until };
  },

  async add_buffer(args, ctx) {
    const found = await findByRef(ctx.phoneNumber, args.ref);
    if (!found || found.kind !== 'task') {
      return { error: `No task found matching "${args.ref}". Buffers apply to tasks.` };
    }
    found.doc.bufferMinutes = args.minutes;
    await found.doc.save();
    return { task: taskSummary(found.doc), bufferMinutes: args.minutes };
  },

  // ---- Emotional care ----------------------------------------------

  async log_mood(args, ctx) {
    await MemoryFact.create({
      phoneNumber: ctx.phoneNumber,
      fact: `Mood: ${args.state}${args.trigger ? ` (trigger: ${args.trigger})` : ''}`,
      category: 'mood'
    });
    return { logged: args.state };
  },

  async lighten_day(args, ctx) {
    const { start, end } = dayRange(ctx.now);
    const query = {
      phoneNumber: ctx.phoneNumber,
      status: { $in: ['pending', 'in_progress'] },
      isFixedTime: false,
      canBeRescheduled: true,
      $or: [
        { scheduledStart: { $gte: start, $lte: end } },
        { dueDate: { $gte: start, $lte: end } }
      ]
    };

    if (args.level === 'light') {
      query.elasticity = 'droppable';
    } else if (args.level === 'minimal') {
      query.priority = { $ne: 'urgent' };
    }
    // clear_flexible: all flexible tasks, no extra filter

    const tasks = await Task.find(query);
    for (const t of tasks) {
      t.status = 'deferred';
      t.scheduledStart = null;
      t.scheduledEnd = null;
      t.notes = `${t.notes ? t.notes + '\n' : ''}DEFERRED (lighten_day ${args.level}): ${args.reason || 'user needed a lighter day'}`;
      await t.save();
    }

    return {
      level: args.level,
      deferred: tasks.map((t) => t.title),
      note: 'Deferred tasks keep their deadlines; re-plan them onto other days this week.'
    };
  },

  async schedule_break(args, ctx) {
    let start;
    if (args.when) {
      start = new Date(args.when);
    } else {
      const slot = await findFreeSlotOnDay(
        ctx.phoneNumber,
        ctx.now,
        args.durationMinutes,
        new Date(ctx.now.getTime() + 5 * 60000)
      );
      if (!slot) return { error: 'No free gap left today for a break.' };
      start = slot.start;
    }

    const event = await Event.create({
      phoneNumber: ctx.phoneNumber,
      title: 'Break',
      category: 'health',
      startTime: start,
      endTime: new Date(start.getTime() + args.durationMinutes * 60000),
      isMovable: true,
      source: 'system',
      notes: 'Recovery break'
    });
    await refreshReminders(ctx.phoneNumber);
    return { break: eventSummary(event) };
  },

  // ---- Relationships ------------------------------------------------

  async upsert_contact(args, ctx) {
    const set = { lastMentionedAt: ctx.now };
    if (args.role) set.role = args.role;
    if (args.company) set.company = args.company;
    if (args.notes) set.notes = args.notes;

    const contact = await Contact.findOneAndUpdate(
      { phoneNumber: ctx.phoneNumber, name: args.name },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { contact: { name: contact.name, role: contact.role, company: contact.company } };
  },

  async update_deal(args, ctx) {
    const update = { $set: { status: args.status } };
    if (args.note) {
      update.$push = { notes: { $each: [{ text: args.note, at: ctx.now }], $position: 0 } };
    }
    const deal = await Deal.findOneAndUpdate(
      { phoneNumber: ctx.phoneNumber, clientName: args.clientName },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { deal: { clientName: deal.clientName, status: deal.status } };
  },

  async log_promise(args, ctx) {
    const c = await Commitment.create({
      phoneNumber: ctx.phoneNumber,
      direction: args.direction,
      who: args.who,
      what: args.what,
      due: args.due ? new Date(args.due) : null
    });
    return { promise: { id: c._id.toString(), direction: c.direction, who: c.who, what: c.what, due: c.due } };
  },

  async due_followups(args, ctx) {
    const soon = new Date(ctx.now.getTime() + 3 * 24 * 3600000);
    const staleCutoff = new Date(ctx.now.getTime() - 7 * 24 * 3600000);

    const overdue = await Commitment.find({
      phoneNumber: ctx.phoneNumber,
      status: 'open',
      due: { $lt: ctx.now, $ne: null }
    });
    const dueSoon = await Commitment.find({
      phoneNumber: ctx.phoneNumber,
      status: 'open',
      due: { $gte: ctx.now, $lte: soon }
    });
    const staleDeals = await Deal.find({
      phoneNumber: ctx.phoneNumber,
      status: { $in: ['lead', 'live', 'stalled'] },
      updatedAt: { $lt: staleCutoff }
    });

    const fmt = (c) => ({ direction: c.direction, who: c.who, what: c.what, due: c.due });
    return {
      overduePromises: overdue.map(fmt),
      dueSoonPromises: dueSoon.map(fmt),
      staleDeals: staleDeals.map((d) => ({
        clientName: d.clientName,
        status: d.status,
        daysSinceTouch: Math.floor((ctx.now - d.updatedAt) / 86400000)
      }))
    };
  },

  // ---- Memory and review ---------------------------------------------

  async save_fact(args, ctx) {
    const fact = await MemoryFact.create({
      phoneNumber: ctx.phoneNumber,
      fact: args.fact,
      category: args.category
    });
    return { saved: { fact: fact.fact, category: fact.category } };
  },

  async recall(args, ctx) {
    const regex = { $regex: escapeRegex(args.query).split(/\s+/).join('|'), $options: 'i' };

    const facts = await MemoryFact.find({ phoneNumber: ctx.phoneNumber, fact: regex })
      .sort({ createdAt: -1 })
      .limit(10);
    const promises = await Commitment.find({
      phoneNumber: ctx.phoneNumber,
      $or: [{ what: regex }, { who: regex }]
    }).limit(10);
    const contacts = await Contact.find({ phoneNumber: ctx.phoneNumber, name: regex }).limit(5);

    return {
      facts: facts.map((f) => ({ fact: f.fact, category: f.category, when: f.createdAt })),
      promises: promises.map((p) => ({ direction: p.direction, who: p.who, what: p.what, status: p.status })),
      contacts: contacts.map((c) => ({ name: c.name, role: c.role, company: c.company }))
    };
  },

  async evening_review(args, ctx) {
    const { start, end } = dayRange(ctx.now);
    const tomorrow = new Date(ctx.now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start: tStart, end: tEnd } = dayRange(tomorrow);

    const todayTasks = await Task.find({
      phoneNumber: ctx.phoneNumber,
      $or: [
        { scheduledStart: { $gte: start, $lte: end } },
        { dueDate: { $gte: start, $lte: end } }
      ]
    });

    const tomorrowEvents = await Event.find({
      phoneNumber: ctx.phoneNumber,
      startTime: { $gte: tStart, $lte: tEnd }
    }).sort({ startTime: 1 });
    const tomorrowTasks = await Task.find({
      phoneNumber: ctx.phoneNumber,
      status: { $in: ['pending', 'in_progress'] },
      scheduledStart: { $gte: tStart, $lte: tEnd }
    }).sort({ scheduledStart: 1 });

    return {
      completed: todayTasks.filter((t) => t.status === 'completed').map((t) => t.title),
      slipped: todayTasks
        .filter((t) => ['pending', 'in_progress'].includes(t.status) && t.scheduledEnd && t.scheduledEnd < ctx.now)
        .map((t) => t.title),
      deferred: todayTasks.filter((t) => t.status === 'deferred').map((t) => t.title),
      tomorrow: {
        events: tomorrowEvents.map(eventSummary),
        tasks: tomorrowTasks.map(taskSummary)
      }
    };
  },

  async weekly_retro(args, ctx) {
    const weekAgo = new Date(ctx.now.getTime() - 7 * 24 * 3600000);

    const tasks = await Task.find({
      phoneNumber: ctx.phoneNumber,
      updatedAt: { $gte: weekAgo }
    });

    const byDomain = {};
    let moved = 0;
    let deferred = 0;
    for (const t of tasks) {
      const d = t.domain || 'personal';
      byDomain[d] = byDomain[d] || { completed: 0, total: 0 };
      byDomain[d].total++;
      if (t.status === 'completed') byDomain[d].completed++;
      if ((t.notes || '').includes('MOVED:')) moved++;
      if (t.status === 'deferred') deferred++;
    }

    const moods = await MemoryFact.find({
      phoneNumber: ctx.phoneNumber,
      category: 'mood',
      createdAt: { $gte: weekAgo }
    }).sort({ createdAt: 1 });

    return {
      window: 'last 7 days',
      byDomain,
      tasksMoved: moved,
      tasksDeferred: deferred,
      moodTimeline: moods.map((m) => ({ when: m.createdAt, entry: m.fact })),
      hint: 'If a domain shows chronic moves/deferrals, suggest save_fact with the pattern and add_buffer where relevant.'
    };
  }
};

/**
 * Execute one tool call. Never throws: errors come back as { error }
 * so the LLM can recover conversationally.
 *
 * @param {string} name - Tool name from the LLM tool call
 * @param {object} args - Parsed tool arguments
 * @param {object} ctx - { phoneNumber, now }
 */
async function executeTool(name, args, ctx) {
  const handler = handlers[name];
  if (!handler) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    return await handler(args, ctx);
  } catch (err) {
    console.error(`[dispatcher] ${name} failed:`, err.message);
    return { error: `${name} failed: ${err.message}` };
  }
}

module.exports = {
  executeTool,
  handlers
};
