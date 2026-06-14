const express = require('express');
const router = express.Router();

const {
  getGoals,
  createGoal,
  updateGoal,
  completeGoal,
  pauseGoal,
  deleteGoal,
} = require('../controllers/goalController');

router.route('/')
  .get(getGoals)
  .post(createGoal);

router.patch('/:id/complete', completeGoal);
router.patch('/:id/pause', pauseGoal);

router.route('/:id')
  .patch(updateGoal)
  .delete(deleteGoal);

module.exports = router;
