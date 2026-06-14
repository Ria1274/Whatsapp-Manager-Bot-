const express = require('express');
const router = express.Router();

const {
  getTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  getTodayTasks,
} = require('../controllers/taskController');

// List tasks & create task
router.route('/')
  .get(getTasks)
  .post(createTask);

// Specific filters (Keep before /:id!)
router.get('/today', getTodayTasks);

// Specific actions
router.patch('/:id/complete', completeTask);

// Retrieve details / update / delete task
router.route('/:id')
  .patch(updateTask)
  .delete(deleteTask);

module.exports = router;
