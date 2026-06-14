# WhatsApp Manager Bot — Context-Aware Scheduling Agent

An intelligent WhatsApp-based productivity assistant that uses **multi-stage NLP intent classification**, **constraint-based scheduling optimization**, and **voice-to-intent processing** to manage tasks, goals, events, and daily plans through natural language — including Hinglish (code-mixed English + Hindi).

## System Architecture

```
WhatsApp User
    │
    ▼
Twilio Gateway (Webhook POST)
    │
    ▼
Express Server (webhookController.js)
    │
    ├── Voice Note? → transcriptionService.js → OpenAI Whisper API
    │
    ▼
NLP Pipeline
    ├── contextBuilder.js     → Fetches session state + recent conversation
    ├── llmParser.js          → GPT-4o-mini Structured Outputs (strict JSON schema)
    ├── fallbackParser.js     → Deterministic regex parser (graceful degradation)
    ├── entityNormalizer.js   → Cleans dates, enums, booleans
    └── decisionRouter.js     → Confidence gating + missing field validation
    │
    ▼
Execution Layer
    ├── whatsappService.js    → Intent dispatcher (create task, list goals, etc.)
    ├── rescheduleService.js  → Constraint-based heuristic rescheduling algorithm
    ├── dailyPlannerService.js→ Morning plan generator
    └── reminderService.js    → Cron-based reminder daemon
    │
    ▼
MongoDB (Atlas or In-Memory fallback)
```

## Key Features

- **Natural Language Task Management**: Create tasks, events, goals, and reminders by chatting naturally
- **Hinglish Support**: Understands code-mixed language (e.g., "kal client meeting hai 11 baje")
- **Voice Note Processing**: Send WhatsApp voice messages — auto-transcribed and executed
- **Constraint-Based Rescheduling**: When you miss commitments, the bot auto-shifts flexible tasks around fixed events using priority-weighted heuristic optimization
- **Multi-Turn Conversation State**: Remembers what it asked you and routes short replies ("yes", "no") correctly
- **Graceful Degradation**: Falls back to deterministic regex parsing if the LLM API is unavailable
- **TwiML XML Responses**: Native Twilio integration with proper XML serialization

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express |
| NLP | OpenAI GPT-4o-mini (Structured Outputs) |
| Speech-to-Text | OpenAI Whisper API |
| Database | MongoDB Atlas / mongodb-memory-server |
| Messaging | Twilio WhatsApp Sandbox |
| Scheduling | node-cron |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Ria1274/Whatsapp-Manager-Bot-.git
cd whatsapp-manager-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start the server
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 7000) |
| `MONGODB_URI` | MongoDB connection string |
| `OPENAI_API_KEY` | OpenAI API key for GPT + Whisper |
| `OPENAI_MODEL` | Model name (default: gpt-4o-mini) |
| `OPENAI_BASE_URL` | Custom endpoint (for Gemini, OpenRouter, etc.) |
| `VERIFY_TOKEN` | Webhook verification token |

## Rescheduling Algorithm

The constraint-based scheduler treats daily planning as a **Constraint Satisfaction Problem (CSP)**:

1. **Hard constraints**: Fixed events and non-movable tasks form immutable time blocks
2. **Interval merging**: Overlapping busy blocks are merged into a unified timeline
3. **Priority sorting**: Flexible tasks are ranked (urgent → high → medium → low)
4. **Sequential fitting**: Tasks are placed into vacant slots in priority order
5. **Overflow handling**: Tasks that don't fit today are pushed to 9:00 AM next day
6. **Boundary constraints**: No tasks scheduled after 10:00 PM

## Project Structure

```
src/
├── app.js                    # Express app setup
├── server.js                 # Entry point
├── config/
│   └── db.js                 # MongoDB connection (with in-memory fallback)
├── controllers/
│   ├── webhookController.js  # Twilio webhook handler + TwiML serializer
│   ├── taskController.js     # REST API for tasks
│   └── goalController.js     # REST API for goals
├── models/
│   ├── Task.js               # Task schema (priority, scheduling, recurrence)
│   ├── Event.js              # Event schema (fixed time blocks)
│   ├── Goal.js               # Goal schema (metrics, targets)
│   ├── User.js               # User profile
│   ├── SessionState.js       # Multi-turn conversation state machine
│   └── ConversationLog.js    # Message history
├── nlp/
│   ├── processMessage.js     # NLP pipeline orchestrator
│   ├── contextBuilder.js     # Session state + history retrieval
│   ├── llmParser.js          # OpenAI Structured Outputs parser
│   ├── parserSchema.js       # JSON schema definition
│   ├── intentTypes.js        # Intent and category enums
│   ├── entityNormalizer.js   # Type coercion and defaults
│   ├── decisionRouter.js     # Confidence gating + field validation
│   └── fallbackParser.js     # Regex-based offline parser
├── services/
│   ├── whatsappService.js    # Core intent dispatcher
│   ├── rescheduleService.js  # Constraint-based rescheduling engine
│   ├── dailyPlannerService.js# Morning schedule generator
│   ├── reminderService.js    # Cron job reminder daemon
│   ├── transcriptionService.js # Whisper audio transcription
│   └── userService.js        # User profile management
└── tests/
    ├── testNlp.js            # NLP pipeline tests
    ├── testWhatsappService.js # End-to-end service tests
    └── testWebhook.js        # Webhook + voice note tests
```

## License

MIT
