// Tool definitions for the agent orchestrator (OpenAI function-calling format).
//
// Modeled on the working qualities of an elite personal assistant / chief of staff:
//   anticipation      - prepares briefings and spots conflicts before being asked
//   discretion        - absorbs small delays silently, escalates only what matters
//   time protection   - guards deep-work blocks, manages buffers
//   emotional care    - reads mood, lightens the day, never guilt-trips
//   relationship mgmt - contacts, deals, promises owed in both directions
//   follow-through    - reviews, pattern learning, long-term memory
//
// Tool descriptions double as behavioral instructions to the LLM: they encode
// WHEN to call each tool, not just what it does. The dispatcher that executes
// these lives in the agent loop, not here.

const DOMAINS = ['startup', 'health', 'family', 'friends', 'errands', 'learning', 'personal'];

// Priority weight per life domain. Used by the planner to decide what gets
// dropped or moved when the day no longer fits.
const DOMAIN_WEIGHTS = {
  startup: 1.0,
  health: 0.8,
  family: 0.6,
  learning: 0.5,
  personal: 0.4,
  errands: 0.3,
  friends: 0.2
};

const ELASTICITY = ['fixed', 'movable_today', 'movable_this_week', 'droppable'];

const MOOD_STATES = ['stressed', 'tired', 'low', 'neutral', 'energized', 'great'];

const DEAL_STATUSES = ['lead', 'live', 'stalled', 'won', 'dead'];

// Escalation policy: how the agent decides whether to speak at all.
// Referenced by the system prompt and by absorb_delay's executor.
const ESCALATION_POLICY = {
  silentShiftMaxMinutes: 15, // shifts under this, touching nothing fixed -> say nothing
  notify: 'a fixed event moved or a task was dropped',
  ask: 'a decision is needed (cancel meeting? notify client?)',
  intervene: 'a deadline is at risk or a conflict cannot be auto-resolved'
};

/**
 * Build one strict-mode tool definition.
 * Strict mode requires every property listed in `required` and
 * additionalProperties: false. Optional fields are nullable instead.
 */
function tool(name, description, properties = {}) {
  return {
    type: 'function',
    function: {
      name,
      description,
      strict: true,
      parameters: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false
      }
    }
  };
}

const TOOLS = [

  // ---------------------------------------------------------------
  // Core scheduling primitives
  // ---------------------------------------------------------------

  tool(
    'create_task',
    'Create a flexible task. Use for anything the user wants done that is not a fixed-time appointment. Infer domain and elasticity from context; when unsure, ask rather than guess elasticity for important items.',
    {
      title: { type: 'string', description: 'Short task title in clean English.' },
      domain: { type: 'string', enum: DOMAINS },
      elasticity: {
        type: 'string',
        enum: ELASTICITY,
        description: 'fixed = never auto-move. movable_today = can shift within the day. movable_this_week = can move to another day. droppable = can be silently removed under pressure.'
      },
      durationMinutes: { type: 'number', description: 'Estimated duration in minutes.' },
      deadline: { type: ['string', 'null'], description: 'ISO-8601 hard deadline, or null.' },
      preferredStart: { type: ['string', 'null'], description: 'ISO-8601 preferred start time, or null to let the planner place it.' },
      notes: { type: ['string', 'null'] }
    }
  ),

  tool(
    'create_event',
    'Create a fixed-time event (meeting, appointment, call). Events are immovable blocks for the planner.',
    {
      title: { type: 'string' },
      start: { type: 'string', description: 'ISO-8601 start.' },
      end: { type: 'string', description: 'ISO-8601 end.' },
      relatedPerson: { type: ['string', 'null'], description: 'Contact name this event is with, if any.' },
      location: { type: ['string', 'null'] }
    }
  ),

  tool(
    'move_task',
    'Move a task or event to a new time. Use when the user asks, or after absorb_delay/lighten_day decides something must shift.',
    {
      ref: { type: 'string', description: 'Task/event id, or its title if id unknown.' },
      newStart: { type: 'string', description: 'ISO-8601 new start time.' },
      reason: { type: 'string', description: 'Why it moved. Stored for the weekly retro.' }
    }
  ),

  tool(
    'cancel_task',
    'Cancel a task or event. For fixed events involving another person, first ask the user whether the other party should be informed.',
    {
      ref: { type: 'string' },
      reason: { type: 'string' }
    }
  ),

  tool(
    'complete_task',
    'Mark a task or event as done. Also call when the user implies completion ("meeting went well").',
    {
      ref: { type: 'string' }
    }
  ),

  // ---------------------------------------------------------------
  // Anticipation - prepare before being asked
  // ---------------------------------------------------------------

  tool(
    'get_briefing',
    'Fetch the schedule with conflicts and prep gaps. Call for "what does my day look like", after the user wakes up, or before composing any plan summary.',
    {
      scope: { type: 'string', enum: ['today', 'tomorrow', 'week', 'month'] }
    }
  ),

  tool(
    'prep_brief',
    'Build a pre-meeting brief for an upcoming event: who the person is, deal status, last conversation, open promises in both directions. Call proactively before client meetings.',
    {
      eventRef: { type: 'string' }
    }
  ),

  tool(
    'scan_conflicts',
    'Scan upcoming days for overbooking, back-to-back overload, or missing prep time. Call when new commitments land on busy days.',
    {
      horizonDays: { type: 'number', description: 'How many days ahead to scan.' }
    }
  ),

  tool(
    'suggest_slot',
    'Find the best free slot for a new item given duration and domain. Use before creating tasks with no preferred time.',
    {
      durationMinutes: { type: 'number' },
      domain: { type: 'string', enum: DOMAINS },
      deadline: { type: ['string', 'null'], description: 'ISO-8601 latest acceptable date, or null.' }
    }
  ),

  // ---------------------------------------------------------------
  // Discretion - absorb small problems, surface big ones
  // ---------------------------------------------------------------

  tool(
    'absorb_delay',
    'The user is running late (unpredictable break, overrunning task, traffic). Replans the rest of the day. If the total shift is under the silent threshold and nothing fixed is affected, the result says silent=true: acknowledge briefly or not at all, never list every small change. Only narrate changes when something important moved.',
    {
      minutes: { type: 'number', description: 'Estimated delay in minutes.' },
      cause: { type: ['string', 'null'], description: 'What caused it, if known. Never used to guilt-trip.' }
    }
  ),

  tool(
    'escalate',
    'Record that something needs the user\'s explicit attention or decision. Use sparingly: severity notify = FYI, ask = decision needed, intervene = deadline or commitment at risk.',
    {
      message: { type: 'string' },
      severity: { type: 'string', enum: ['notify', 'ask', 'intervene'] }
    }
  ),

  // ---------------------------------------------------------------
  // Time protection - gatekeeping
  // ---------------------------------------------------------------

  tool(
    'protect_block',
    'Reserve a deep-work block. No reminders or nags fire inside it, and the planner treats it as immovable.',
    {
      start: { type: 'string', description: 'ISO-8601 start.' },
      end: { type: 'string', description: 'ISO-8601 end.' },
      label: { type: 'string' }
    }
  ),

  tool(
    'set_dnd',
    'Full do-not-disturb: suppress all proactive messages until the given time. Reminders that would have fired are summarized afterwards.',
    {
      until: { type: 'string', description: 'ISO-8601 time DND ends.' }
    }
  ),

  tool(
    'add_buffer',
    'Add invisible padding after a task or event. Use when the user or the weekly retro shows something chronically overruns.',
    {
      ref: { type: 'string' },
      minutes: { type: 'number' }
    }
  ),

  // ---------------------------------------------------------------
  // Emotional care - mood-aware planning
  // ---------------------------------------------------------------

  tool(
    'log_mood',
    'Record the user\'s emotional state when it is stated or clearly implied by tone. Feeds the planner. Do NOT immediately pivot to schedule changes when the user is venting - listen first, offer lighten_day only once the conversation settles.',
    {
      state: { type: 'string', enum: MOOD_STATES },
      trigger: { type: ['string', 'null'], description: 'What caused it, if mentioned.' }
    }
  ),

  tool(
    'lighten_day',
    'Reduce today\'s load. light = drop droppables. minimal = keep only fixed events and urgent deadlines. clear_flexible = everything movable goes to later this week. Confirm with the user before minimal or clear_flexible.',
    {
      level: { type: 'string', enum: ['light', 'minimal', 'clear_flexible'] },
      reason: { type: ['string', 'null'] }
    }
  ),

  tool(
    'schedule_break',
    'Insert a recovery break into the day. Use after long stretches of fixed events or when mood is low.',
    {
      durationMinutes: { type: 'number' },
      when: { type: ['string', 'null'], description: 'ISO-8601 start, or null for the next sensible gap.' }
    }
  ),

  // ---------------------------------------------------------------
  // Relationship management - contacts, deals, promises
  // ---------------------------------------------------------------

  tool(
    'upsert_contact',
    'Create or update a person the user deals with. Call whenever a new name appears in a business or personal context.',
    {
      name: { type: 'string' },
      role: { type: ['string', 'null'], description: 'e.g. client, investor, friend, parent.' },
      company: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] }
    }
  ),

  tool(
    'update_deal',
    'Create or update a deal\'s status. Infer status changes from conversation ("Sharma signed!" -> won).',
    {
      clientName: { type: 'string' },
      status: { type: 'string', enum: DEAL_STATUSES },
      note: { type: ['string', 'null'] }
    }
  ),

  tool(
    'log_promise',
    'Record a commitment in either direction: something the user owes someone, or someone owes the user. These surface in due_followups and prep_brief.',
    {
      direction: { type: 'string', enum: ['owed_by_me', 'owed_to_me'] },
      who: { type: 'string' },
      what: { type: 'string' },
      due: { type: ['string', 'null'], description: 'ISO-8601 due date, or null.' }
    }
  ),

  tool(
    'due_followups',
    'List stale deals, overdue promises, and contacts going quiet. Call during morning briefing and when the user asks "what am I forgetting".',
    {}
  ),

  // ---------------------------------------------------------------
  // Follow-through - memory and review loops
  // ---------------------------------------------------------------

  tool(
    'save_fact',
    'Persist a durable fact about the user: routines ("breakfast 8:30"), patterns ("morning tasks overrun ~10 min"), preferences ("no calls before 10"). The planner reads these. Save facts the moment they are learned.',
    {
      fact: { type: 'string' },
      category: { type: 'string', enum: ['routine', 'preference', 'pattern', 'other'] }
    }
  ),

  tool(
    'recall',
    'Search saved facts, past conversations, and promises. Call before answering "what did I say about X" or when context seems to be missing.',
    {
      query: { type: 'string' }
    }
  ),

  tool(
    'evening_review',
    'Compile the end-of-day review: what got done, what slipped, tomorrow\'s preview. Usually triggered by the nightly job, but callable if the user asks to wrap up the day.',
    {}
  ),

  tool(
    'weekly_retro',
    'Mine the week for patterns: chronic overruns, always-late slots, dropped domains. Produces buffer adjustments and save_fact suggestions.',
    {}
  )
];

const TOOL_NAMES = TOOLS.map((t) => t.function.name);

module.exports = {
  TOOLS,
  TOOL_NAMES,
  DOMAINS,
  DOMAIN_WEIGHTS,
  ELASTICITY,
  MOOD_STATES,
  DEAL_STATUSES,
  ESCALATION_POLICY
};
