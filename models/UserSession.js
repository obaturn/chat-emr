const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserSession = sequelize.define('UserSession', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    socketId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    connectedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    disconnectedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    sessionDuration: {
      type: DataTypes.INTEGER, // in seconds
      allowNull: true,
    },
  }, {
    tableName: 'user_sessions',
    indexes: [
      {
        fields: ['user_id'],
      },
      {
        fields: ['socket_id'],
        unique: true,
      },
      {
        fields: ['is_active'],
      },
      {
        fields: ['connected_at'],
      },
    ],
  });

  return UserSession;
};