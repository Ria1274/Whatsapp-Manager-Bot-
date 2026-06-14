const Task = require('../models/Task');

// @desc    Get all tasks
// @route   GET /api/tasks
const getTasks = async (req, res, next) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new task
// @route   POST /api/tasks
const createTask = async (req, res, next) => {
  try {
    const {
      title,
      description,
      category,
      dueDate,
      status,
      priority,
      estimatedDurationMinutes,
      scheduledStart,
      scheduledEnd,
      isFixedTime,
      canBeRescheduled,
      canBeSkipped,
      energyRequired,
      source,
      relatedGoal,
      reminderTimes,
      recurrence,
      notes,
    } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      res.status(400);
      throw new Error('Please provide a valid task title');
    }

    const task = await Task.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category || 'other',
      dueDate,
      status: status || 'pending',
      priority: priority || 'medium',
      estimatedDurationMinutes: estimatedDurationMinutes || 30,
      scheduledStart,
      scheduledEnd,
      isFixedTime: isFixedTime || false,
      canBeRescheduled: canBeRescheduled !== undefined ? canBeRescheduled : true,
      canBeSkipped: canBeSkipped !== undefined ? canBeSkipped : true,
      energyRequired: energyRequired || 'medium',
      source: source || 'manual',
      relatedGoal: relatedGoal || null,
      reminderTimes: reminderTimes || [],
      recurrence: recurrence || 'none',
      notes: notes ? notes.trim() : '',
    });

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
};

// @desc    Update task details
// @route   PATCH /api/tasks/:id
const updateTask = async (req, res, next) => {
  try {
    const allowedUpdates = [
      'title',
      'description',
      'category',
      'dueDate',
      'status',
      'priority',
      'estimatedDurationMinutes',
      'scheduledStart',
      'scheduledEnd',
      'isFixedTime',
      'canBeRescheduled',
      'canBeSkipped',
      'energyRequired',
      'source',
      'relatedGoal',
      'reminderTimes',
      'recurrence',
      'notes',
    ];

    const updates = {};

    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (updates.title && typeof updates.title === 'string') {
      updates.title = updates.title.trim();
    }

    if (updates.description && typeof updates.description === 'string') {
      updates.description = updates.description.trim();
    }

    if (updates.notes && typeof updates.notes === 'string') {
      updates.notes = updates.notes.trim();
    }

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!task) {
      res.status(404);
      throw new Error('Task not found');
    }

    res.status(200).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark task as completed
// @route   PATCH /api/tasks/:id/complete
const completeTask = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, { status: 'completed' }, { new: true });
    if (!task) { res.status(404); throw new Error('Task not found'); }
    res.status(200).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a task
// @route   DELETE /api/tasks/:id
const deleteTask = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) { res.status(404); throw new Error('Task not found'); }
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

// @desc    Get today's tasks
// @route   GET /api/tasks/today
const getTodayTasks = async (req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const tasks = await Task.find({
      status: { $ne: 'completed' },
      $or: [
        {
          dueDate: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        },
        {
          scheduledStart: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        },
      ],
    }).sort({
      priority: -1,
      scheduledStart: 1,
      dueDate: 1,
    });

    res.status(200).json({
      success: true,
      count: tasks.length,
      data: tasks,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  getTodayTasks,
};
