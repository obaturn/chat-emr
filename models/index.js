const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config();

// Database configuration
const isSQLite = process.env.DB_DIALECT === 'sqlite';

const sequelize = isSQLite
  ? new Sequelize({
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || './database.sqlite',
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      define: {
        timestamps: true,
        underscored: true,
      }
    })
  : new Sequelize({
      dialect: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'emr_chat_db',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true',
      pool: {
        max: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
        min: 0,
        acquire: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 60000,
        idle: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000
      },
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      define: {
        timestamps: true,
        underscored: true,
      }
    });

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
};

// Import models
const Message = require('./Message')(sequelize);
const User = require('./User')(sequelize);
const UserSession = require('./UserSession')(sequelize);

// Define associations
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'recipientId', as: 'recipient' });
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' });
User.hasMany(Message, { foreignKey: 'recipientId', as: 'receivedMessages' });

User.hasMany(UserSession, { foreignKey: 'userId', as: 'sessions' });
UserSession.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Sync database (create tables)
const syncDatabase = async () => {
  try {
    // Sync tables in correct order to handle foreign key constraints
    await User.sync({ force: true });
    console.log('✅ Users table synchronized.');

    await UserSession.sync({ force: true });
    console.log('✅ UserSessions table synchronized.');

    await Message.sync({ force: true });
    console.log('✅ Messages table synchronized.');

    console.log('✅ Database synchronized successfully.');
  } catch (error) {
    console.error('❌ Error synchronizing database:', error);
  }
};

module.exports = {
  sequelize,
  Sequelize,
  Message,
  User,
  UserSession,
  testConnection,
  syncDatabase
};