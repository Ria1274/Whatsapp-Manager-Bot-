require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { startScheduler } = require('./services/schedulerService');

const PORT = process.env.PORT || 3000;

// Initialize Server
const initServer = async () => {
    // 1. Connect to Database first
    await connectDB();

    // 2. Start durable job scheduler (morning quote, T-5 reminders, reviews)
    await startScheduler();

    // 3. Open Express Server
    app.listen(PORT, () => {
        console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
};

initServer();
