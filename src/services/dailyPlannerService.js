const Task = require('../models/Task');

const generateDailyPlan = async (phoneNumber, date = new Date()) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const tasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    $or: [
      { dueDate: { $gte: startOfDay, $lte: endOfDay } },
      { scheduledStart: { $gte: startOfDay, $lte: endOfDay } },
    ],
  }).sort({
    scheduledStart: 1,
    dueDate: 1,
    priority: -1,
  });

  if (tasks.length === 0) {
    return {
      message: "Good morning Ria. No hard tasks today. Don't use that as an excuse to disappear though.",
      tasks: [],
    };
  }

  const planLines = tasks.map((task, index) => {
    const time = task.scheduledStart
      ? task.scheduledStart.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Flexible';

    return `${index + 1}. ${time} — ${task.title} [${task.priority}]`;
  });

  return {
    message:
      "Good morning Ria. Reply when you're up.\n\n" +
      "Here is your plan for today:\n" +
      planLines.join('\n'),
    tasks,
  };
};

module.exports = {
  generateDailyPlan,
};
