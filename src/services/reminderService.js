const cron = require('node-cron');
const User = require('../models/User');
const Task = require('../models/Task');
const Goal = require('../models/Goal');
const { realSendWhatsAppMessage } = require('./whatsappService');
const ConversationLog = require('../models/ConversationLog');

const fireDailyReminders = async () => {
    try {
        console.log("⏰ Running Reminder Cron Job...");
        
        const users = await User.find();
        if (users.length === 0) {
           console.log("No users found to remind. Skipping.");
           return;
        }

        for (const user of users) {
           const pendingTasks = await Task.countDocuments({ status: { $in: ['pending', 'in_progress'] } });
           const activeGoals = await Goal.countDocuments({ status: 'active' });

           if (pendingTasks === 0 && activeGoals === 0) continue;

           const reminderMsg = `⏰ *Daily Reminder!*\nYou have ${pendingTasks} pending tasks and ${activeGoals} active goals. Keep pushing forward! Use "List tasks" to see what's on your plate today.`;

           await realSendWhatsAppMessage(user.phoneNumber, reminderMsg);

           await ConversationLog.create({
               message: reminderMsg,
               sender: "BOT (System Reminder)",
               detectedIntent: "system_reminder",
               responseText: reminderMsg
           });
        }
        
    } catch (err) {
        console.error("Error in reminder service:", err);
    }
};

const startCronJobs = () => {
    // Scheduling every minute for MVP testing
    cron.schedule('* * * * *', fireDailyReminders);
    console.log("🕒 Reminder Cron Jobs scheduled successfully (Running every minute).");
};

module.exports = {
    startCronJobs,
    fireDailyReminders
};
