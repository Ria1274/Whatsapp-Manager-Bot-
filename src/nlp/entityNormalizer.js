/**
 * Normalize and clean entities parsed from the LLM output.
 * Ensures optional parameters exist, converts empty strings to null,
 * and sets default fallback values.
 * 
 * @param {object} parsed - The raw JSON output from the LLM (matching PARSER_SCHEMA)
 * @returns {object} Cleaned and normalized parsed object
 */
function normalizeEntities(parsed) {
  const rawEntities = parsed.entities || {};
  const normalized = {};

  // Standard string cleanups
  normalized.title = cleanString(rawEntities.title);
  normalized.description = cleanString(rawEntities.description);
  normalized.goalMetric = cleanString(rawEntities.goalMetric);
  normalized.unit = cleanString(rawEntities.unit);
  normalized.relatedPerson = cleanString(rawEntities.relatedPerson);
  normalized.replyMeaning = cleanString(rawEntities.replyMeaning);
  normalized.notes = cleanString(rawEntities.notes) || normalized.description || '';

  // Categorical defaults
  normalized.category = cleanEnum(rawEntities.category, 'other');
  normalized.priority = cleanEnum(rawEntities.priority, 'medium');
  normalized.energyRequired = cleanEnum(rawEntities.energyRequired, 'medium');
  normalized.recurrence = cleanEnum(rawEntities.recurrence, 'none');

  // Datetime mapping
  normalized.datetime = {
    start: null,
    end: null
  };

  if (rawEntities.datetime) {
    if (rawEntities.datetime.start) {
      normalized.datetime.start = new Date(rawEntities.datetime.start);
    }
    if (rawEntities.datetime.end) {
      normalized.datetime.end = new Date(rawEntities.datetime.end);
    }
  }

  // Date parsing
  normalized.dueDate = rawEntities.dueDate ? new Date(rawEntities.dueDate) : null;
  normalized.targetDate = rawEntities.targetDate ? new Date(rawEntities.targetDate) : null;

  // Numeric parsing
  normalized.estimatedDurationMinutes = cleanNumber(rawEntities.estimatedDurationMinutes, 30);
  normalized.targetValue = cleanNumber(rawEntities.targetValue, 0);
  normalized.currentValue = cleanNumber(rawEntities.currentValue, 0);

  // Boolean parsing
  normalized.isFixedTime = cleanBoolean(rawEntities.isFixedTime, false);
  normalized.canBeRescheduled = cleanBoolean(rawEntities.canBeRescheduled, true);
  normalized.canBeSkipped = cleanBoolean(rawEntities.canBeSkipped, true);

  // Return the parent object with normalized entities
  return {
    ...parsed,
    entities: normalized
  };
}

function cleanString(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

function cleanEnum(val, defaultValue) {
  if (val === undefined || val === null) return defaultValue;
  const str = String(val).toLowerCase().trim();
  return str === '' ? defaultValue : str;
}

function cleanNumber(val, defaultValue) {
  if (val === undefined || val === null) return defaultValue;
  const num = Number(val);
  return isNaN(num) ? defaultValue : num;
}

function cleanBoolean(val, defaultValue) {
  if (val === undefined || val === null) return defaultValue;
  if (typeof val === 'boolean') return val;
  if (String(val).toLowerCase().trim() === 'true') return true;
  if (String(val).toLowerCase().trim() === 'false') return false;
  return defaultValue;
}

module.exports = {
  normalizeEntities
};
