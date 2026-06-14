const Task = require('../models/Task');
const SessionState = require('../models/SessionState');
const Event = require('../models/Event');

const handleWakeUpReply = async (phoneNumber, actualWakeTime = new Date()) => {
  const todayStart = new Date(actualWakeTime);
  todayStart.setHours(0, 0, 0, 0);

  const missedTasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    scheduledEnd: { $lt: actualWakeTime, $gte: todayStart },
  }).sort({ scheduledStart: 1 });

  if (missedTasks.length === 0) {
    // Clear active session action since wake up is normal
    await SessionState.findOneAndUpdate(
      { phoneNumber },
      { pendingAction: null, pendingIntent: null, pendingEntities: {} },
      { upsert: true }
    );
    return {
      message:
        "Okay Ria, you're up. No major damage yet. Let's not manufacture chaos for fun.",
    };
  }

  const missedList = missedTasks
    .map((task, index) => `${index + 1}. ${task.title}`)
    .join('\n');

  // Lock the user session state to wait for their manage decision
  await SessionState.findOneAndUpdate(
    { phoneNumber },
    { 
      pendingAction: 'awaiting_manage_decision', 
      pendingIntent: 'wake_up_reply', 
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) 
    },
    { upsert: true }
  );

  return {
    message:
      `Ria, you missed ${missedTasks.length} planned task(s):\n` +
      `${missedList}\n\n` +
      "Can you still manage the next fixed commitment? Reply: YES MANAGE or NO REPLAN.",
  };
};

const handleCanManageReply = async (phoneNumber) => {
  // Clear the pending state
  await SessionState.findOneAndUpdate(
    { phoneNumber },
    { pendingAction: null, pendingIntent: null, pendingEntities: {} }
  );

  return {
    message: "Awesome. Keep pushing forward! I have noted that you can manage the schedule.",
  };
};

const handleCannotManageReply = async (phoneNumber) => {
  // Clear the pending state
  await SessionState.findOneAndUpdate(
    { phoneNumber },
    { pendingAction: null, pendingIntent: null, pendingEntities: {} }
  );

  return {
    message: "Noted. I'll need to reschedule your day. Type 'replan' or let me adjust your schedule.",
  };
};

const rescheduleDay = async (phoneNumber) => {
  // Clear the pending state
  await SessionState.findOneAndUpdate(
    { phoneNumber },
    { pendingAction: null, pendingIntent: null, pendingEntities: {} }
  );

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // 1. Fetch fixed blocks (events) scheduled for today
  const events = await Event.find({
    phoneNumber,
    startTime: { $lte: todayEnd },
    endTime: { $gte: todayStart }
  });

  const fixedIntervals = [];
  for (const event of events) {
    fixedIntervals.push({
      start: new Date(event.startTime),
      end: new Date(event.endTime),
      title: event.title,
      type: 'event'
    });
  }

  // 2. Fetch fixed tasks (cannot be rescheduled or fixed time) scheduled for today
  const fixedTasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    $or: [
      { isFixedTime: true },
      { canBeRescheduled: false }
    ],
    scheduledStart: { $exists: true, $ne: null }
  });

  for (const task of fixedTasks) {
    if (task.scheduledStart && task.scheduledEnd) {
      fixedIntervals.push({
        start: new Date(task.scheduledStart),
        end: new Date(task.scheduledEnd),
        title: task.title,
        type: 'fixed_task'
      });
    }
  }

  // Merge overlapping or contiguous fixed intervals
  fixedIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const mergedIntervals = [];
  for (const interval of fixedIntervals) {
    if (mergedIntervals.length === 0) {
      mergedIntervals.push(interval);
    } else {
      const last = mergedIntervals[mergedIntervals.length - 1];
      if (interval.start.getTime() <= last.end.getTime()) {
        last.end = new Date(Math.max(last.end.getTime(), interval.end.getTime()));
      } else {
        mergedIntervals.push(interval);
      }
    }
  }

  // 3. Fetch flexible tasks that need slots
  const flexibleTasks = await Task.find({
    phoneNumber,
    status: { $in: ['pending', 'in_progress'] },
    isFixedTime: false,
    canBeRescheduled: true
  });

  if (flexibleTasks.length === 0) {
    return {
      message: "No flexible tasks to reschedule! Your schedule is already clear. Keep up the good work! 🌟"
    };
  }

  // Sort flexible tasks by priority (urgent -> high -> medium -> low)
  const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };
  flexibleTasks.sort((a, b) => {
    const pA = priorityWeights[a.priority] || 2;
    const pB = priorityWeights[b.priority] || 2;
    if (pB !== pA) return pB - pA;
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  // 4. Fit tasks into vacant slots starting from now + 10 mins buffer
  let candidateStart = Math.max(now.getTime() + 10 * 60 * 1000, todayStart.getTime());
  const rescheduledTasks = [];

  for (const task of flexibleTasks) {
    const duration = (task.estimatedDurationMinutes || 30) * 60 * 1000;
    let foundSlot = false;

    while (!foundSlot) {
      // Shift candidateStart to 9 AM next day if it pushes past 10 PM
      const candidateDate = new Date(candidateStart);
      if (candidateDate.getHours() >= 22) {
        candidateDate.setDate(candidateDate.getDate() + 1);
        candidateDate.setHours(9, 0, 0, 0);
        candidateStart = candidateDate.getTime();
      }

      let candidateEnd = candidateStart + duration;
      let overlap = null;

      // Check if this candidate overlaps with any merged fixed interval
      for (const interval of mergedIntervals) {
        const iStart = interval.start.getTime();
        const iEnd = interval.end.getTime();

        if (candidateStart < iEnd && candidateEnd > iStart) {
          overlap = interval;
          break;
        }
      }

      if (overlap) {
        candidateStart = overlap.end.getTime();
      } else {
        // Double check against already rescheduled tasks in this run to avoid overlapping them
        let rescheduledOverlap = null;
        for (const res of rescheduledTasks) {
          const rStart = res.start.getTime();
          const rEnd = res.end.getTime();
          if (candidateStart < rEnd && candidateEnd > rStart) {
            rescheduledOverlap = res;
            break;
          }
        }

        if (rescheduledOverlap) {
          candidateStart = rescheduledOverlap.end.getTime();
        } else {
          foundSlot = true;
          const slotStart = new Date(candidateStart);
          const slotEnd = new Date(candidateEnd);

          task.scheduledStart = slotStart;
          task.scheduledEnd = slotEnd;
          await task.save();

          rescheduledTasks.push({
            title: task.title,
            priority: task.priority,
            start: slotStart,
            end: slotEnd
          });

          // Move current search time to end of slot
          candidateStart = candidateEnd;
        }
      }
    }
  }

  // 5. Format the confirmation response message
  const lines = rescheduledTasks.map((t) => {
    const timeStr = t.start.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const dayStr = t.start.toDateString() === now.toDateString() ? 'Today' : 'Tomorrow';
    return `• *${t.title}* [${t.priority}] -> ${dayStr} at ${timeStr}`;
  });

  return {
    message:
      "🔄 *Schedule Re-planned!*\n\n" +
      "I have auto-shifted your flexible tasks around your fixed commitments:\n\n" +
      lines.join('\n') +
      "\n\nKeep tracking! Let's crush this. 💪"
  };
};

module.exports = {
  handleWakeUpReply,
  handleCanManageReply,
  handleCannotManageReply,
  rescheduleDay
};
