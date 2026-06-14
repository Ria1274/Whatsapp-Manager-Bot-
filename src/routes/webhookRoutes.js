const express = require('express');
const router = express.Router();
const { verifyWebhook, receiveMessage } = require('../controllers/webhookController');

router.route('/')
  .get(verifyWebhook)
  .post(receiveMessage);

module.exports = router;
