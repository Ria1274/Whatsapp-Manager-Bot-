const { processMessage } = require('../nlp/processMessage');
const Task = require('../models/Task');
const Goal = require('../models/Goal');
const Event = require('../models/Event');
const ConversationLog = require('../models/ConversationLog');
const dailyPlannerService = require('./dailyPlannerService');
const rescheduleService = require('./rescheduleService');
const { getUserProfile } = require('./userService');
const axios = require('axios');

// Meta sender kept for future use, but NOT used in Twilio webhook flow
const realSendWhatsAppMessage = async (to, message) => {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneId || token === 'your_meta_access_token_here') {
      console.log(`\n[Warning] WHATSAPP_TOKEN or PHONE_NUMBER_ID missing in .env.`);
      console.log(`[Mock Reply]: ${message}\n`);
      return true;
    }

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: message }
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Real WhatsApp Message successfully fired to ${to}`);
    return true;
  } catch (err) {
    console.error(
      '❌ Failed to send real WhatsApp message:',
      err.response ? JSON.stringify(err.response.data) : err.message
    );
    return false;
  }
};

// Main logic for an incoming message
const handleIncomingMessage = async (text, senderNumber) => {
  // 1. Ensure user profile exists in database
  await getUserProfile(senderNumber);

  // 2. Log incoming message
  await ConversationLog.create({
    message: text || '[Empty or untranscribed voice message]',
    sender: `USER: ${senderNumber}`,
  });

  // 2b. Agent mode: LLM tool-calling loop replaces the intent pipeline.
  // Any failure falls through to the legacy pipeline below.
  if (process.env.AGENT_MODE === 'true') {
    try {
      const { runAgent } = require('../agent/agentLoop');
      const agentReply = await runAgent(text, senderNumber);

      await ConversationLog.create({
        message: agentReply,
        sender: 'BOT',
        detectedIntent: 'agent',
        responseText: agentReply
      });

      return { success: true, intent: 'agent', confidence: 1, responseText: agentReply };
    } catch (err) {
      console.error('[whatsappService] Agent loop failed, falling back to legacy pipeline:', err.message);
    }
  }

  // 3. Process with OpenAI Structured Outputs NLP pipeline
  const nlpResult = await processMessage(text, senderNumber);
  const { intent, confidence, extractedEntities, nextStep } = nlpResult;

  let responseText = '';

  // 4. Check if the decision router says we need more info before executing
  if (nextStep.action !== 'execute') {
    // Don't execute — ask for clarification, confirmation, or missing info
    responseText = nextStep.message;
  } else {
    // 5. Execute the action
    try {
      switch (intent) {
        // ── Create Task ──────────────────────────────────────────────
        case 'create_task':
        case 'create_reminder': // A basic reminder is just a task with a dueDate
        case 'create_deadline_task': {
          if (!extractedEntities.title) {
            responseText = "Please provide a task title.";
          } else {
            const taskData = {
              phoneNumber: senderNumber,
              title: extractedEntities.title,
              description: extractedEntities.description || '',
              dueDate: extractedEntities.dueDate || (extractedEntities.datetime ? extractedEntities.datetime.start : null),
              priority: extractedEntities.priority || 'medium',
              category: extractedEntities.category || 'other',
              estimatedDurationMinutes: extractedEntities.estimatedDurationMinutes || 30,
              scheduledStart: extractedEntities.datetime ? extractedEntities.datetime.start : null,
              scheduledEnd: extractedEntities.datetime ? extractedEntities.datetime.end : null,
              isFixedTime: extractedEntities.isFixedTime || false,
              canBeRescheduled: extractedEntities.canBeRescheduled !== undefined ? extractedEntities.canBeRescheduled : true,
              canBeSkipped: extractedEntities.canBeSkipped !== undefined ? extractedEntities.canBeSkipped : true,
              energyRequired: extractedEntities.energyRequired || 'medium',
              recurrence: extractedEntities.recurrence || 'none',
              source: 'whatsapp'
            };

            const t = await Task.create(taskData);

            responseText = `✅ Task created: "${t.title}" (Priority: ${t.priority})`;
            if (t.dueDate) {
              responseText += `\n📅 Due: ${t.dueDate.toLocaleDateString('en-IN', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}`;
            }
          }
          break;
        }

        // ── Create Event ─────────────────────────────────────────────
        case 'create_event': {
          if (!extractedEntities.title) {
            responseText = "Please provide an event title.";
          } else {
            const startTime = extractedEntities.datetime && extractedEntities.datetime.start 
              ? new Date(extractedEntities.datetime.start) 
              : new Date();
            
            let endTime;
            if (extractedEntities.datetime && extractedEntities.datetime.end) {
              endTime = new Date(extractedEntities.datetime.end);
            } else if (extractedEntities.estimatedDurationMinutes) {
              endTime = new Date(startTime.getTime() + extractedEntities.estimatedDurationMinutes * 60 * 1000);
            } else {
              endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour default
            }

            const eventData = {
              phoneNumber: senderNumber,
              title: extractedEntities.title,
              description: extractedEntities.description || '',
              category: extractedEntities.category || 'other',
              startTime,
              endTime,
              isMovable: extractedEntities.canBeRescheduled !== undefined ? extractedEntities.canBeRescheduled : false,
              source: 'whatsapp',
              notes: extractedEntities.notes || ''
            };

            if (extractedEntities.relatedPerson) {
              const relStr = `Related Person: ${extractedEntities.relatedPerson}`;
              eventData.notes = eventData.notes ? `${eventData.notes}\n${relStr}` : relStr;
            }

            const ev = await Event.create(eventData);

            responseText = `📅 Event scheduled: "${ev.title}"`;
            responseText += `\n⏰ Start: ${ev.startTime.toLocaleDateString('en-IN', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}`;
          }
          break;
        }

        // ── List Tasks ───────────────────────────────────────────────
        case 'list_tasks': {
          const pendingTasks = await Task.find({
            phoneNumber: senderNumber,
            status: { $in: ['pending', 'in_progress'] }
          });

          if (pendingTasks.length === 0) {
            responseText = "You have no pending tasks! Enjoy your day. 🎉";
          } else {
            responseText =
              "📝 Your Pending Tasks:\n" +
              pendingTasks.map((t, i) => {
                let line = `${i + 1}. [${t.priority}] ${t.title}`;
                if (t.dueDate) {
                  line += ` (Due: ${t.dueDate.toLocaleDateString('en-IN', {
                    month: 'short',
                    day: 'numeric'
                  })})`;
                }
                return line;
              }).join('\n');
          }
          break;
        }

        // ── Create Goal ──────────────────────────────────────────────
        case 'create_goal': {
          if (!extractedEntities.title) {
            responseText = "Please provide a goal title.";
          } else {
            const goalData = {
              phoneNumber: senderNumber,
              title: extractedEntities.title,
              description: extractedEntities.description || '',
              category: extractedEntities.category || 'other',
              targetDate: extractedEntities.targetDate || (extractedEntities.datetime ? extractedEntities.datetime.start : null),
              priority: extractedEntities.priority || 'medium',
              targetMetric: extractedEntities.goalMetric || '',
              targetValue: extractedEntities.targetValue || 0,
              unit: extractedEntities.unit || '',
              source: 'whatsapp',
              notes: extractedEntities.notes || ''
            };

            const g = await Goal.create(goalData);

            responseText = `🎯 Goal created: "${g.title}"`;
            if (g.targetDate) {
              responseText += `\n📅 Target: ${g.targetDate.toLocaleDateString('en-IN', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}`;
            }
          }
          break;
        }

        // ── List Goals ───────────────────────────────────────────────
        case 'list_goals': {
          const activeGoals = await Goal.find({
            phoneNumber: senderNumber,
            status: 'active'
          });

          if (activeGoals.length === 0) {
            responseText = "You have no active goals right now.";
          } else {
            responseText =
              "🎯 Your Active Goals:\n" +
              activeGoals.map((g, i) => {
                let line = `${i + 1}. ${g.title}`;
                if (g.targetDate) {
                  line += ` (Target: ${g.targetDate.toLocaleDateString('en-IN', {
                    month: 'short',
                    day: 'numeric'
                  })})`;
                }
                return line;
              }).join('\n');
          }
          break;
        }

        // ── Complete Task ────────────────────────────────────────────
        case 'complete_task': {
          if (!extractedEntities.title) {
            responseText = "Specify which task is complete.";
          } else {
            const taskQuery = await Task.findOne({
              phoneNumber: senderNumber,
              title: { $regex: extractedEntities.title, $options: 'i' },
              status: { $in: ['pending', 'in_progress'] }
            });

            if (taskQuery) {
              taskQuery.status = 'completed';
              await taskQuery.save();
              responseText = `✅ Marked task "${taskQuery.title}" as completed!`;
            } else {
              responseText = `Couldn't find an incomplete task matching "${extractedEntities.title}".`;
            }
          }
          break;
        }

        // ── Generate Daily Plan ──────────────────────────────────────
        case 'generate_daily_plan': {
          const plan = await dailyPlannerService.generateDailyPlan(senderNumber);
          responseText = plan.message;
          break;
        }

        // ── Wake Up Reply ────────────────────────────────────────────
        case 'wake_up_reply': {
          const result = await rescheduleService.handleWakeUpReply(senderNumber, new Date());
          responseText = result.message;
          break;
        }

        // ── Can Manage Reply ──────────────────────────────────────────
        case 'can_manage_reply': {
          const result = await rescheduleService.handleCanManageReply(senderNumber);
          responseText = result.message;
          break;
        }

        // ── Cannot Manage Reply ───────────────────────────────────────
        case 'cannot_manage_reply': {
          const result = await rescheduleService.handleCannotManageReply(senderNumber);
          responseText = result.message;
          break;
        }

        // ── Reschedule Day ────────────────────────────────────────────
        case 'reschedule_day': {
          const result = await rescheduleService.rescheduleDay(senderNumber);
          responseText = result.message;
          break;
        }

        // ── Emotional Rant ───────────────────────────────────────────
        case 'emotional_rant': {
          responseText =
            "I hear you. It sounds like a lot right now. 💙\n\n" +
            "Let's not solve everything at once. " +
            "Send me the top 3 things stressing you out, " +
            "and I'll help you organize them into manageable tasks.\n\n" +
            "You've got this. One step at a time.";
          break;
        }

        // ── Casual Conversation ──────────────────────────────────────
        case 'casual_conversation': {
          responseText =
            "Hey! 👋 I'm your productivity buddy. " +
            "I'm best at helping you track tasks, set reminders, and crush goals.\n\n" +
            "Try saying things like:\n" +
            '• "Remind me to call the client tomorrow at 4pm"\n' +
            '• "Add task finish the report by Friday"\n' +
            '• "Show my tasks"\n' +
            '• "I want to read 12 books this year"';
          break;
        }

        // ── Help / Fallback ──────────────────────────────────────────
        case 'help':
        default: {
          responseText =
            "Hi! I'm your WhatsApp Manager Bot. 🤖\n\n" +
            "Here's what I can do:\n" +
            '📝 *Tasks* — "Add task wash the dishes"\n' +
            '⏰ *Reminders* — "Remind me to call mom tomorrow at 5pm"\n' +
            '📅 *Deadlines* — "By Friday I need to send the proposal"\n' +
            '🎯 *Goals* — "I want to lose 4kg by next month"\n' +
            '📅 *Plan* — "Show my plan for today"\n' +
            '✅ *Complete* — "Mark dishes as done"\n' +
            '📋 *View* — "Show my tasks" or "List goals"\n\n' +
            "Just talk to me naturally — I understand English, Hinglish, and more!";
          break;
        }
      }
    } catch (err) {
      console.error('Action error:', err);
      responseText = "Oops, something went wrong while processing that request.";
    }
  }

  // 6. Log outgoing message
  await ConversationLog.create({
    message: responseText,
    sender: 'BOT',
    detectedIntent: intent,
    extractedEntities,
    responseText
  });

  // 7. Return the response (controller sends it as plain text for Twilio)
  return { success: true, intent, confidence, responseText };
};

module.exports = {
  realSendWhatsAppMessage,
  handleIncomingMessage
};
