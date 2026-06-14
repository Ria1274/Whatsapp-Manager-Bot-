/**
 * Fallback Parser
 * Uses regex pattern matching to parse basic intents if the OpenAI API call fails or times out.
 * 
 * @param {string} text - Cleaned message text
 * @returns {object} Simple mock-LLM response conforming to PARSER_SCHEMA
 */
function parseFallback(text) {
  const lowercaseText = text.toLowerCase().trim();
  let intent = 'unknown';
  let confidence = 0.5;
  const entities = {
    title: null,
    description: null,
    category: 'other',
    priority: 'medium',
    datetime: { start: null, end: null },
    dueDate: null,
    targetDate: null,
    estimatedDurationMinutes: 30,
    isFixedTime: false,
    canBeRescheduled: true,
    canBeSkipped: true,
    energyRequired: 'medium',
    recurrence: 'none',
    goalMetric: null,
    targetValue: null,
    unit: null,
    relatedPerson: null,
    replyMeaning: null
  };
  const missingFields = [];
  let requiresConfirmation = false;
  let reason = 'Offline fallback parser triggered.';

  // 1. Wake up reply
  if (/\b(i'?m\s+up|i\s+am\s+up|awake|woke\s+up|uth\s+gayi)\b/i.test(lowercaseText)) {
    intent = 'wake_up_reply';
    confidence = 0.9;
    entities.replyMeaning = 'wake_up';
  }
  // 2. Can manage reply
  else if (/\b(yes\s+i\s+can\s+manage|i'?ll\s+manage|can\s+manage|yes|yep|ha[an]?)\b/i.test(lowercaseText)) {
    intent = 'can_manage_reply';
    confidence = 0.95;
    entities.replyMeaning = 'yes';
  }
  // 3. Cannot manage / reschedule
  else if (/\b(i\s+can'?t\s+manage|replan|can'?t\s+make\s+it|no|nah|nahi|na)\b/i.test(lowercaseText)) {
    intent = 'reschedule_day';
    confidence = 0.9;
    entities.replyMeaning = 'replan';
  }
  // 4. List tasks
  else if (/\b(list|show|view|get)\s+tasks?\b/i.test(lowercaseText)) {
    intent = 'list_tasks';
    confidence = 0.95;
  }
  // 5. List goals
  else if (/\b(list|show|view|get)\s+goals?\b/i.test(lowercaseText)) {
    intent = 'list_goals';
    confidence = 0.95;
  }
  // 6. Create Task
  else if (/(add|create|new)\s+task/i.test(lowercaseText)) {
    intent = 'create_task';
    confidence = 0.8;
    entities.title = lowercaseText.replace(/(add|create|new)\s+task\s*/i, '').trim();
    if (entities.title.length === 0) {
      entities.title = null;
      missingFields.push('title');
    }
  }
  // 7. Create Goal
  else if (/(add|create|new)\s+goal/i.test(lowercaseText)) {
    intent = 'create_goal';
    confidence = 0.8;
    entities.title = lowercaseText.replace(/(add|create|new)\s+goal\s*/i, '').trim();
    if (entities.title.length === 0) {
      entities.title = null;
      missingFields.push('title');
    }
  }
  // 8. Help
  else if (/\b(help|guide|info|menu|what\s+can\s+you\s+do)\b/i.test(lowercaseText)) {
    intent = 'help';
    confidence = 0.95;
  }

  // Capitalize first letter of title if present
  if (entities.title) {
    entities.title = entities.title.charAt(0).toUpperCase() + entities.title.slice(1);
  }

  return {
    intent,
    confidence,
    entities,
    missingFields,
    requiresConfirmation,
    reason
  };
}

module.exports = {
  parseFallback
};
