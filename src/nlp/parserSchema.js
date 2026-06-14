const {
  ALLOWED_INTENTS,
  ALLOWED_CATEGORIES,
  ALLOWED_PRIORITIES,
  ALLOWED_ENERGY_REQUIRED,
  ALLOWED_RECURRENCE
} = require('./intentTypes');

// JSON schema for OpenAI Structured Outputs.
// Note: In strict mode, every property must be in the required array. 
// If a property is optional/nullable, we list it as type: ["type", "null"]
const PARSER_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ALLOWED_INTENTS
    },
    confidence: {
      type: 'number',
      description: 'Confidence score between 0.0 and 1.0'
    },
    entities: {
      type: 'object',
      properties: {
        title: {
          type: ['string', 'null'],
          description: 'Title of the task, goal, event, or reminder.'
        },
        description: {
          type: ['string', 'null'],
          description: 'Detailed description or notes extracted.'
        },
        category: {
          type: ['string', 'null'],
          enum: ALLOWED_CATEGORIES
        },
        priority: {
          type: ['string', 'null'],
          enum: ALLOWED_PRIORITIES
        },
        datetime: {
          type: 'object',
          properties: {
            start: {
              type: ['string', 'null'],
              description: 'ISO-8601 string representing start date and time.'
            },
            end: {
              type: ['string', 'null'],
              description: 'ISO-8601 string representing end date and time.'
            }
          },
          required: ['start', 'end'],
          additionalProperties: false
        },
        dueDate: {
          type: ['string', 'null'],
          description: 'ISO-8601 string representing due date for tasks.'
        },
        targetDate: {
          type: ['string', 'null'],
          description: 'ISO-8601 string representing target completion date for goals.'
        },
        estimatedDurationMinutes: {
          type: ['number', 'null'],
          description: 'Estimated duration in minutes.'
        },
        isFixedTime: {
          type: ['boolean', 'null'],
          description: 'Whether this occurs at a strict non-movable time block (true for events, false for tasks).'
        },
        canBeRescheduled: {
          type: ['boolean', 'null'],
          description: 'Whether this task can be moved to another slot.'
        },
        canBeSkipped: {
          type: ['boolean', 'null'],
          description: 'Whether this task is optional.'
        },
        energyRequired: {
          type: ['string', 'null'],
          enum: ALLOWED_ENERGY_REQUIRED
        },
        recurrence: {
          type: ['string', 'null'],
          enum: ALLOWED_RECURRENCE
        },
        goalMetric: {
          type: ['string', 'null'],
          description: 'What metric is tracked for this goal (e.g. body weight, money, pages).'
        },
        targetValue: {
          type: ['number', 'null'],
          description: 'Target numerical value for goals.'
        },
        unit: {
          type: ['string', 'null'],
          description: 'Measurement unit (e.g. kg, dollars, pages).'
        },
        relatedPerson: {
          type: ['string', 'null'],
          description: 'Name of the person linked to this request (e.g. Sumeet).'
        },
        replyMeaning: {
          type: ['string', 'null'],
          description: 'Meaning of short replies: yes, no, done, replan, wake_up, etc.'
        }
      },
      required: [
        'title',
        'description',
        'category',
        'priority',
        'datetime',
        'dueDate',
        'targetDate',
        'estimatedDurationMinutes',
        'isFixedTime',
        'canBeRescheduled',
        'canBeSkipped',
        'energyRequired',
        'recurrence',
        'goalMetric',
        'targetValue',
        'unit',
        'relatedPerson',
        'replyMeaning'
      ],
      additionalProperties: false
    },
    missingFields: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: 'Required fields for this intent that are missing from the prompt (e.g. datetime for reminders).'
    },
    requiresConfirmation: {
      type: 'boolean',
      description: 'Whether this requires explicit user confirmation before executing.'
    },
    reason: {
      type: 'string',
      description: 'Reasoning behind the intent and entity classification.'
    }
  },
  required: [
    'intent',
    'confidence',
    'entities',
    'missingFields',
    'requiresConfirmation',
    'reason'
  ],
  additionalProperties: false
};

module.exports = {
  PARSER_SCHEMA
};
