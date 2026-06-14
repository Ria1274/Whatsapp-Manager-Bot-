const { OpenAI } = require('openai');
const { PARSER_SCHEMA } = require('./parserSchema');

// Lazy-load OpenAI client
let openaiInstance = null;

function getOpenAIClient() {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY is not configured in environment.');
    }
    const config = { apiKey };
    if (process.env.OPENAI_BASE_URL) {
      config.baseURL = process.env.OPENAI_BASE_URL;
    }
    openaiInstance = new OpenAI(config);
  }
  return openaiInstance;
}

/**
 * Parse raw user input using OpenAI Structured Outputs json_schema.
 * 
 * @param {string} text - Raw message from user
 * @param {object} context - Context object from contextBuilder
 * @returns {Promise<object>} Parsed JSON structure conforming to PARSER_SCHEMA
 */
async function parseWithLLM(text, context) {
  try {
    const openai = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const currentDateTimeStr = context.currentDateTime.toISOString();

    const systemPrompt = `
You are the NLP parser layer for a highly agentic WhatsApp productivity manager bot.
Your job is to parse the user's message and structure it into clean, unified JSON.
You only parse; you DO NOT write replies or execute database changes.

Today's current date and time is: ${currentDateTimeStr}
User's timezone: ${context.timezone} (All relative date parsing like "tomorrow", "kal", "next week" must resolve relative to this).

If the user writes in Hinglish (Romanized Hindi/English mix), translate intents and entity values (like titles) into clean English.
Example: "kal subah client meeting hai 11 baje, 1hr prep chahiye"
- intent: "create_event"
- entities:
  - title: "Meeting with client"
  - datetime: { start: "(tomorrow's date)T11:00:00.000Z", end: "(tomorrow's date)T12:00:00.000Z" } (infer 1hr duration if none specified, or look at preparationRequiredMinutes)
  - isFixedTime: true
  - preparationRequiredMinutes: 60

Conversational context context block:
${JSON.stringify({
  recentConversation: context.recentConversation,
  lastBotMessage: context.lastBotMessage,
  pendingAction: context.pendingAction
}, null, 2)}

Rules for context lookup:
- If the user responds with a short confirmation/denial like "yes", "no", "done", "I can't", use the 'pendingAction' in the context to determine the correct intent.
- If pendingAction is "awaiting_manage_decision" and user says "yes I can manage", return "can_manage_reply".
- If pendingAction is "awaiting_wake_up_reply" and user says "I am up", return "wake_up_reply".
`;

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Message to parse: "${text}"` }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nlp_parse_schema',
          strict: true,
          schema: PARSER_SCHEMA
        }
      },
      temperature: 0.1 // Keep it deterministic
    });

    const parsedJson = JSON.parse(response.choices[0].message.content);
    return parsedJson;

  } catch (error) {
    console.error('[llmParser] Parsing failed:', error.message);
    throw error; // Let processMessage handle the fallback
  }
}

module.exports = {
  parseWithLLM
};
