const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    senderId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    senderName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    senderRole: {
      type: DataTypes.ENUM('doctor', 'nurse', 'pharmacy', 'patient', 'admin'),
      allowNull: false,
    },
    recipientId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'messages',
    indexes: [
      {
        fields: ['sender_id', 'recipient_id'],
      },
      {
        fields: ['recipient_id', 'read'],
      },
      {
        fields: ['timestamp'],
      },
    ],
  });

  return Message;
};