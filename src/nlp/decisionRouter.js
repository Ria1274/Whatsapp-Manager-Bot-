/**
 * Decision Router
 * Determines if a parsed intent and its entities are safe to execute,
 * require confirmation, or require prompting the user for missing info.
 * 
 * @param {object} parsed - The normalized parsed output from entityNormalizer
 * @param {object} context - The context block from contextBuilder
 * @returns {{ action: string, message: string }} Decision routing output
 */
function decideNextStep(parsed, context) {
  const intent = parsed.intent;
  const confidence = parsed.confidence;
  const entities = parsed.entities;
  const missingFields = [...(parsed.missingFields || [])];

  // 1. Check confidence threshold
  if (confidence < 0.55) {
    return {
      action: 'ask_clarification',
      message: "I didn't quite get that. Did you want me to add a task, schedule an event, set a reminder, or show your plan? 🤔"
    };
  }

  // 2. Validate required fields per intent, populating missingFields dynamically if needed
  if (intent === 'create_task') {
    if (!entities.title) {
      if (!missingFields.includes('title')) missingFields.push('title');
    }
  }

  if (intent === 'create_reminder') {
    if (!entities.title) {
      if (!missingFields.includes('title')) missingFields.push('title');
    }
    if (!entities.datetime || !entities.datetime.start) {
      if (!missingFields.includes('datetime')) missingFields.push('datetime');
    }
  }

  if (intent === 'create_event') {
    if (!entities.title) {
      if (!missingFields.includes('title')) missingFields.push('title');
    }
    if (!entities.datetime || !entities.datetime.start) {
      if (!missingFields.includes('datetime')) missingFields.push('datetime');
    }
  }

  if (intent === 'create_goal') {
    if (!entities.title) {
      if (!missingFields.includes('title')) missingFields.push('title');
    }
  }

  // Awaiting reply states validations
  if (intent === 'can_manage_reply' || intent === 'cannot_manage_reply') {
    if (context.pendingAction !== 'awaiting_manage_decision') {
      return {
        action: 'ask_clarification',
        message: "You mentioned managing a commitment, but I wasn't expecting that right now. How can I help you?"
      };
    }
  }

  // 3. Route based on missing fields
  if (missingFields.length > 0) {
    const missing = missingFields[0]; // Ask for the first missing field

    if (missing === 'title') {
      return {
        action: 'ask_missing_info',
        message: "What is the name or title of the item you want to create?"
      };
    }
    if (missing === 'datetime' || missing === 'date' || missing === 'time') {
      return {
        action: 'ask_missing_info',
        message: "When should this start or be scheduled for? (e.g. tomorrow at 4pm, 11am Friday)"
      };
    }
    return {
      action: 'ask_missing_info',
      message: `I'm missing some details. Please provide: ${missingFields.join(', ')}.`
    };
  }

  // 4. Route based on confirmation threshold
  if (confidence >= 0.55 && confidence < 0.75) {
    const friendlyIntent = intent.replace(/_/g, ' ');
    return {
      action: 'confirm',
      message: `I think you want to: *${friendlyIntent}*. Should I save this? (yes/no)`
    };
  }

  // 5. Allowed directly to execution
  return {
    action: 'execute',
    message: 'Action can be executed.'
  };
}

module.exports = {
  decideNextStep
};
