const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Logger middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// API Routes
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/goals', require('./routes/goalRoutes'));
app.use('/webhook', require('./routes/webhookRoutes'));

// Centralized error handler
app.use(errorHandler);

module.exports = app;
