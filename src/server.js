require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { startCronJobs } = require('./services/reminderService');

const PORT = process.env.PORT || 3000;

// Initialize Server
const initServer = async () => {
    // 1. Connect to Database first
    await connectDB();

    // 2. Start Reminder Daemon
    startCronJobs();

    // 3. Open Express Server
    app.listen(PORT, () => {
        console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
};

initServer();
