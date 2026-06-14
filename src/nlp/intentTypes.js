const ALLOWED_INTENTS = [
  'create_task',
  'create_reminder',
  'create_goal',
  'create_event',
  'list_tasks',
  'list_goals',
  'complete_task',
  'update_task',
  'delete_task',
  'generate_daily_plan',
  'wake_up_reply',
  'can_manage_reply',
  'cannot_manage_reply',
  'reschedule_day',
  'prepare_for_tomorrow',
  'emotional_rant',
  'casual_conversation',
  'help',
  'unknown'
];

const ALLOWED_CATEGORIES = [
  'personal',
  'startup',
  'health',
  'academic',
  'work',
  'finance',
  'social',
  'other'
];

const ALLOWED_PRIORITIES = [
  'low',
  'medium',
  'high',
  'urgent'
];

const ALLOWED_ENERGY_REQUIRED = [
  'low',
  'medium',
  'high'
];

const ALLOWED_RECURRENCE = [
  'none',
  'daily',
  'weekly',
  'monthly'
];

module.exports = {
  ALLOWED_INTENTS,
  ALLOWED_CATEGORIES,
  ALLOWED_PRIORITIES,
  ALLOWED_ENERGY_REQUIRED,
  ALLOWED_RECURRENCE
};
