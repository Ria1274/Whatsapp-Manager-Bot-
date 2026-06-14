const Goal = require('../models/Goal');

// @desc    Get all goals
// @route   GET /api/goals
const getGoals = async (req, res, next) => {
  try {
    const goals = await Goal.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: goals.length,
      data: goals,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new goal
// @route   POST /api/goals
const createGoal = async (req, res, next) => {
  try {
    const {
      title,
      description,
      category,
      targetDate,
      status,
      priority,
      targetMetric,
      currentValue,
      targetValue,
      unit,
      frequency,
      weeklyCommitment,
      milestones,
      notes,
    } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      res.status(400);
      throw new Error('Please provide a valid goal title');
    }

    const goal = await Goal.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category || 'other',
      targetDate,
      status: status || 'active',
      priority: priority || 'medium',
      targetMetric: targetMetric || '',
      currentValue: currentValue || 0,
      targetValue: targetValue || 0,
      unit: unit || '',
      frequency: frequency || 'none',
      weeklyCommitment: weeklyCommitment || 0,
      milestones: milestones || [],
      notes: notes ? notes.trim() : '',
    });

    res.status(201).json({
      success: true,
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update goal
// @route   PATCH /api/goals/:id
const updateGoal = async (req, res, next) => {
  try {
    const allowedUpdates = [
      'title',
      'description',
      'category',
      'targetDate',
      'status',
      'priority',
      'targetMetric',
      'currentValue',
      'targetValue',
      'unit',
      'frequency',
      'weeklyCommitment',
      'linkedTasks',
      'milestones',
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

    const goal = await Goal.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!goal) {
      res.status(404);
      throw new Error('Goal not found');
    }

    res.status(200).json({
      success: true,
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark goal as completed
// @route   PATCH /api/goals/:id/complete
const completeGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findByIdAndUpdate(
      req.params.id,
      { status: 'completed' },
      { new: true, runValidators: true }
    );

    if (!goal) {
      res.status(404);
      throw new Error('Goal not found');
    }

    res.status(200).json({
      success: true,
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Pause goal
// @route   PATCH /api/goals/:id/pause
const pauseGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findByIdAndUpdate(
      req.params.id,
      { status: 'paused' },
      { new: true, runValidators: true }
    );

    if (!goal) {
      res.status(404);
      throw new Error('Goal not found');
    }

    res.status(200).json({
      success: true,
      data: goal,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete goal
// @route   DELETE /api/goals/:id
const deleteGoal = async (req, res, next) => {
  try {
    const goal = await Goal.findByIdAndDelete(req.params.id);

    if (!goal) {
      res.status(404);
      throw new Error('Goal not found');
    }

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGoals,
  createGoal,
  updateGoal,
  completeGoal,
  pauseGoal,
  deleteGoal,
};
