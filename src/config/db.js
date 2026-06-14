const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // We add a 5 second timeout so it doesn't hang forever trying to connect via blocked DNS
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000 
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`\n⚠️ Cloud Connection Blocked by your Internet Provider: ${error.message}`);
    console.log(`🚀 Booting up temporary Local In-Memory Database to bypass the block...`);
    
    try {
      // Lazy load to avoid crashing if it's not installed yet
      const { MongoMemoryServer } = require('mongodb-memory-server'); 
      const mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
      console.log(`✅ Success! Local Database running in the background. You can now develop normally!\n`);
    } catch (fallbackError) {
      console.error(`Error starting fallback DB: ${fallbackError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
