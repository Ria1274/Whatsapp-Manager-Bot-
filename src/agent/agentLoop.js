const { OpenAI } = require('openai');
const { TOOLS } = require('./tools');
const { buildSystemPrompt } = require('./persona');
const { executeTool } = require('./dispatcher');
const { buildContext } = require('../nlp/contextBuilder');

const MAX_ITERATIONS = 6;

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
 * Run the agent orchestrator loop for one incoming message.
 *
 * Flow: build context -> LLM with tools -> execute tool calls ->
 * feed results back -> repeat until the LLM answers in plain text
 * (or the iteration cap is hit).
 *
 * Throws on LLM/transport failure so the caller can fall back to the
 * legacy intent-dispatch pipeline.
 *
 * @param {string} text - Incoming user message
 * @param {string} senderNumber - WhatsApp sender id
 * @returns {Promise<string>} Final reply text for the user
 */
async function runAgent(text, senderNumber) {
  const openai = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const context = await buildContext(senderNumber);
  const ctx = { phoneNumber: senderNumber, now: context.currentDateTime };

  const messages = [
    { role: 'system', content: buildSystemPrompt(context) },
    { role: 'user', content: text }
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.4
    });

    const message = response.choices[0].message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || 'Done.';
    }

    messages.push(message);

    for (const call of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch (parseErr) {
        console.error(`[agentLoop] Bad tool arguments for ${call.function.name}:`, parseErr.message);
      }

      console.log(`[agentLoop] tool: ${call.function.name}`, JSON.stringify(args));
      const result = await executeTool(call.function.name, args, ctx);

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  // Iteration cap hit: ask the model to wrap up with what it has, no more tools
  const finalResponse = await openai.chat.completions.create({
    model,
    messages: [
      ...messages,
      {
        role: 'system',
        content: 'Tool budget exhausted. Summarize what was done and reply to the user now, without calling more tools.'
      }
    ],
    temperature: 0.4
  });

  return finalResponse.choices[0].message.content || 'Done - though I hit my step limit. Ask me to double-check if something looks off.';
}

module.exports = {
  runAgent
};
