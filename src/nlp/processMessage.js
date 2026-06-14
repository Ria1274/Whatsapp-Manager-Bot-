const { buildContext } = require('./contextBuilder');
const { parseWithLLM } = require('./llmParser');
const { normalizeEntities } = require('./entityNormalizer');
const { decideNextStep } = require('./decisionRouter');
const { parseFallback } = require('./fallbackParser');

/**
 * Main orchestrator of the NLP pipeline.
 * Clean text, build context, parse with OpenAI, normalize outputs,
 * run decision router, and return final payload.
 * 
 * @param {string} text - Raw message string from the user
 * @param {string} senderNumber - Sender phone number/identifier
 * @returns {Promise<{
 *   intent: string,
 *   confidence: number,
 *   extractedEntities: object,
 *   nextStep: { action: string, message: string },
 *   rawParsed: object,
 *   context: object
 * }>}
 */
async function processMessage(text = '', senderNumber) {
  const cleanText = text.trim();
  console.log(`\n=== 📥 Processing Incoming Message from ${senderNumber} ===`);
  console.log(`Text: "${cleanText}"`);

  // Handle empty text inputs immediately
  if (!cleanText) {
    return {
      intent: 'help',
      confidence: 1.0,
      extractedEntities: {},
      nextStep: {
        action: 'ask_clarification',
        message: "I didn't receive any text. How can I help you today?"
      },
      rawParsed: null,
      context: { senderNumber, currentDateTime: new Date(), timezone: 'Asia/Kolkata' }
    };
  }

  // 1. Build conversational context
  const context = await buildContext(senderNumber);
  console.log(`[processMessage] Context loaded (pendingAction: ${context.pendingAction || 'none'})`);

  let parsed = null;
  let usedFallback = false;

  // 2. Parse using OpenAI (Structured Outputs json_schema)
  try {
    parsed = await parseWithLLM(cleanText, context);
  } catch (error) {
    console.warn(`[processMessage] OpenAI failed — falling back to deterministic parser.`);
    parsed = parseFallback(cleanText);
    usedFallback = true;
  }

  // 3. Clean up and normalize properties
  const normalized = normalizeEntities(parsed);
  console.log(`[processMessage] Entities normalized (Intent: "${normalized.intent}", Confidence: ${normalized.confidence.toFixed(2)})`);

  // 4. Determine deterministic routing action
  const nextStep = decideNextStep(normalized, context);
  console.log(`[processMessage] Router action: "${nextStep.action}"`);

  return {
    intent: normalized.intent,
    confidence: normalized.confidence,
    extractedEntities: normalized.entities,
    nextStep,
    rawParsed: parsed,
    context
  };
}

module.exports = {
  processMessage
};
