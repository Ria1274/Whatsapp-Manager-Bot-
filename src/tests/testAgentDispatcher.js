require('dotenv').config();
const connectDB = require('../config/db');
const { executeTool } = require('../agent/dispatcher');
const Task = require('../models/Task');
const Event = require('../models/Event');
const Contact = require('../models/Contact');
const Deal = require('../models/Deal');
const Commitment = require('../models/Commitment');
const MemoryFact = require('../models/MemoryFact');

async function run() {
  await connectDB();

  const phone = 'whatsapp:+911111111111';
  const ctx = { phoneNumber: phone, now: new Date() };

  // Clean slate
  await Promise.all([
    Task.deleteMany({ phoneNumber: phone }),
    Event.deleteMany({ phoneNumber: phone }),
    Contact.deleteMany({ phoneNumber: phone }),
    Deal.deleteMany({ phoneNumber: phone }),
    Commitment.deleteMany({ phoneNumber: phone }),
    MemoryFact.deleteMany({ phoneNumber: phone })
  ]);

  const results = {};
  const check = (name, result, predicate) => {
    const ok = !result.error && (!predicate || predicate(result));
    results[name] = ok ? 'PASS' : `FAIL: ${JSON.stringify(result)}`;
    console.log(`${ok ? '✅' : '❌'} ${name}`, ok ? '' : JSON.stringify(result, null, 2));
    return result;
  };

  const in2h = new Date(ctx.now.getTime() + 2 * 3600000);
  const in3h = new Date(ctx.now.getTime() + 3 * 3600000);

  // Core scheduling
  check('create_event', await executeTool('create_event', {
    title: 'Client meeting with Sharma',
    start: in2h.toISOString(),
    end: in3h.toISOString(),
    relatedPerson: 'Sharma',
    location: null
  }, ctx), (r) => r.created && r.created.type === 'event');

  const taskRes = check('create_task', await executeTool('create_task', {
    title: 'Prepare pitch deck',
    domain: 'startup',
    elasticity: 'movable_today',
    durationMinutes: 60,
    deadline: null,
    preferredStart: null,
    notes: null
  }, ctx), (r) => r.created && r.created.domain === 'startup' && r.created.priority === 'high');

  check('create_task droppable', await executeTool('create_task', {
    title: 'Sort clothes',
    domain: 'errands',
    elasticity: 'droppable',
    durationMinutes: 20,
    deadline: null,
    preferredStart: null,
    notes: null
  }, ctx), (r) => r.created && r.created.elasticity === 'droppable');

  check('suggest_slot', await executeTool('suggest_slot', {
    durationMinutes: 45,
    domain: 'startup',
    deadline: null
  }, ctx), (r) => r.slot && r.slot.start);

  check('move_task by title', await executeTool('move_task', {
    ref: 'pitch deck',
    newStart: new Date(ctx.now.getTime() + 5 * 3600000).toISOString(),
    reason: 'testing move'
  }, ctx), (r) => r.moved && r.moved.title === 'Prepare pitch deck');

  check('complete_task', await executeTool('complete_task', { ref: taskRes.created.id }, ctx),
    (r) => r.completed && r.completed.status === 'completed');

  // Anticipation
  check('get_briefing today', await executeTool('get_briefing', { scope: 'today' }, ctx),
    (r) => Array.isArray(r.events) && r.events.length === 1);

  check('scan_conflicts', await executeTool('scan_conflicts', { horizonDays: 3 }, ctx),
    (r) => Array.isArray(r.conflicts));

  // Relationships
  check('upsert_contact', await executeTool('upsert_contact', {
    name: 'Sharma', role: 'client', company: 'Sharma Textiles', notes: null
  }, ctx), (r) => r.contact && r.contact.role === 'client');

  check('update_deal', await executeTool('update_deal', {
    clientName: 'Sharma', status: 'live', note: 'Sent proposal, awaiting reply'
  }, ctx), (r) => r.deal && r.deal.status === 'live');

  check('log_promise', await executeTool('log_promise', {
    direction: 'owed_by_me', who: 'Sharma', what: 'Send revised quote',
    due: new Date(ctx.now.getTime() - 3600000).toISOString()
  }, ctx), (r) => r.promise && r.promise.who === 'Sharma');

  check('due_followups', await executeTool('due_followups', {}, ctx),
    (r) => r.overduePromises.length === 1);

  check('prep_brief', await executeTool('prep_brief', { eventRef: 'Client meeting' }, ctx),
    (r) => r.person === 'Sharma' && r.deals.length === 1 && r.openPromises.length === 1);

  // Discretion
  check('absorb_delay small', await executeTool('absorb_delay', { minutes: 10, cause: 'break ran long' }, ctx),
    (r) => r.silent === true);

  check('absorb_delay colliding', await executeTool('absorb_delay', { minutes: 130, cause: 'traffic' }, ctx),
    (r) => r.silent === false && r.affectedFixed.length >= 1);

  // Time protection
  check('protect_block', await executeTool('protect_block', {
    start: new Date(ctx.now.getTime() + 26 * 3600000).toISOString(),
    end: new Date(ctx.now.getTime() + 28 * 3600000).toISOString(),
    label: 'Deep work: fundraise deck'
  }, ctx), (r) => r.protected);

  check('set_dnd', await executeTool('set_dnd', {
    until: new Date(ctx.now.getTime() + 3600000).toISOString()
  }, ctx), (r) => r.dndUntil);

  check('add_buffer', await executeTool('add_buffer', { ref: 'Sort clothes', minutes: 15 }, ctx),
    (r) => r.bufferMinutes === 15);

  // Emotional care
  check('log_mood', await executeTool('log_mood', { state: 'stressed', trigger: 'investor call' }, ctx),
    (r) => r.logged === 'stressed');

  check('lighten_day light', await executeTool('lighten_day', { level: 'light', reason: 'stressed' }, ctx),
    (r) => Array.isArray(r.deferred));

  check('schedule_break', await executeTool('schedule_break', { durationMinutes: 20, when: null }, ctx),
    (r) => r.break || r.error);

  // Memory
  check('save_fact', await executeTool('save_fact', {
    fact: 'Breakfast usually 8:30-9:00, often overruns 10 min', category: 'routine'
  }, ctx), (r) => r.saved);

  check('recall', await executeTool('recall', { query: 'breakfast' }, ctx),
    (r) => r.facts.length === 1);

  // Note: 'Prepare pitch deck' was moved +5h, which can cross midnight IST,
  // so we assert structure rather than membership in today's window.
  check('evening_review', await executeTool('evening_review', {}, ctx),
    (r) => Array.isArray(r.completed) && Array.isArray(r.slipped) && r.tomorrow);

  check('weekly_retro', await executeTool('weekly_retro', {}, ctx),
    (r) => r.byDomain && r.byDomain.startup);

  check('unknown tool', await executeTool('nonexistent', {}, ctx).then((r) => ({ inverted: !r.error })),
    (r) => r.inverted === false);

  const failed = Object.entries(results).filter(([, v]) => v !== 'PASS');
  console.log(`\n${Object.keys(results).length - failed.length}/${Object.keys(results).length} passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
