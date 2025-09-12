const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Import database models and connection
const { sequelize, Message, User, UserSession, testConnection, syncDatabase } = require('./models');
const { Op } = require('sequelize');

// Check if using SQLite
const isSQLite = process.env.DB_DIALECT === 'sqlite';

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173", // Vite dev server
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for real-time operations (database for persistence)
let onlineUsers = new Map(); // Track online users in memory
let userSessions = new Map(); // Track user sessions in memory

// Initialize database connection and sync models
async function initializeDatabase() {
  try {
    await testConnection();
    await syncDatabase();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Helper function to get unread counts for a user from database
async function getUnreadCountsForUser(userId) {
  try {
    const unreadMessages = await Message.findAll({
      where: {
        recipientId: userId,
        read: false
      },
      attributes: [
        'senderId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['senderId']
    });

    const counts = {};
    unreadMessages.forEach(msg => {
      counts[msg.senderId] = parseInt(msg.dataValues.count);
    });

    return counts;
  } catch (error) {
    console.error('Error getting unread counts:', error);
    return {};
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user joining
  socket.on('join', async (userData) => {
    try {
      const { userId, userName, userRole } = userData;

      // Store user in memory for real-time operations
      onlineUsers.set(socket.id, { userId, userName, userRole });
      userSessions.set(userId, socket.id);

      // Find or create user in database
      let user = await User.findOne({ where: { userId } });
      if (!user) {
        user = await User.create({
          userId,
          userName,
          userRole,
          isOnline: true,
          lastSeen: new Date()
        });
      } else {
        await user.update({
          isOnline: true,
          lastSeen: new Date()
        });
      }

      // Create user session
      await UserSession.create({
        userId,
        socketId: socket.id,
        connectedAt: new Date(),
        isActive: true
      });

      // Send queued messages for this user (unread messages from database)
      const queuedMessages = await Message.findAll({
        where: {
          recipientId: userId,
          read: false
        },
        include: [{
          model: User,
          as: 'sender',
          attributes: ['userName', 'userRole']
        }],
        order: [['createdAt', 'ASC']]
      });

      if (queuedMessages.length > 0) {
        const formattedMessages = queuedMessages.map(msg => ({
          id: msg.id,
          text: msg.text,
          senderId: msg.senderId,
          senderName: msg.sender.userName,
          senderRole: msg.sender.userRole,
          recipientId: msg.recipientId,
          timestamp: msg.timestamp,
          read: msg.read
        }));

        console.log(`Sending ${formattedMessages.length} queued messages to ${userName}`);
        socket.emit('queuedMessages', formattedMessages);
      }

      // Send unread message counts for this user
      const userUnreadCounts = await getUnreadCountsForUser(userId);
      if (Object.keys(userUnreadCounts).length > 0) {
        socket.emit('unreadCounts', userUnreadCounts);
      }

      // Broadcast online users list
      io.emit('onlineUsers', Array.from(onlineUsers.values()));

      console.log(`${userName} (${userRole}) joined the chat`);
    } catch (error) {
      console.error('Error in join handler:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });

  // Handle new messages
  socket.on('sendMessage', async (messageData) => {
    try {
      const { text, senderId, senderName, senderRole, timestamp, recipientId } = messageData;

      // Create message in database
      const message = await Message.create({
        id: Date.now().toString(),
        text,
        senderId,
        senderName,
        senderRole,
        recipientId,
        timestamp: timestamp || new Date().toISOString(),
        read: false
      });

      // Check if recipient is online
      const recipientSocketId = userSessions.get(recipientId);
      if (recipientSocketId) {
        // Send directly to recipient
        io.to(recipientSocketId).emit('newMessage', message.toJSON());

        // Send updated unread counts to recipient
        const recipientUnreadCounts = await getUnreadCountsForUser(recipientId);
        io.to(recipientSocketId).emit('unreadCounts', recipientUnreadCounts);
      }

      // Send confirmation to sender
      socket.emit('messageSent', message.id);

      console.log(`Message from ${senderName} to ${recipientId}: ${text}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle message read status
  socket.on('markAsRead', async (messageId) => {
    try {
      const message = await Message.findByPk(messageId);
      if (message) {
        await message.update({ read: true, readAt: new Date() });
        io.emit('messageRead', messageId);
      }
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  });

  // Handle marking conversation as read
  socket.on('markConversationAsRead', async (otherUserId) => {
    try {
      console.log(`📖 Received markConversationAsRead for user: ${otherUserId}`);
      const user = onlineUsers.get(socket.id);
      if (user) {
        console.log(`👤 User ${user.userName} marking conversation with ${otherUserId} as read`);

        // Find all unread messages in this conversation and mark them as read
        const [affectedRows] = await Message.update(
          { read: true, readAt: new Date() },
          {
            where: {
              [Op.or]: [
                {
                  senderId: user.userId,
                  recipientId: otherUserId,
                  read: false
                },
                {
                  senderId: otherUserId,
                  recipientId: user.userId,
                  read: false
                }
              ]
            }
          }
        );

        console.log(`✅ Marked ${affectedRows} messages as read`);

        // Send updated unread counts to user
        const updatedUnreadCounts = await getUnreadCountsForUser(user.userId);
        console.log(`📊 Sending updated unread counts:`, updatedUnreadCounts);
        socket.emit('unreadCounts', updatedUnreadCounts);
      } else {
        console.log(`❌ User not found in onlineUsers for socket ${socket.id}`);
      }
    } catch (error) {
      console.error('❌ Error marking conversation as read:', error);
    }
  });

  // Handle typing indicators
  socket.on('typing', (userData) => {
    socket.broadcast.emit('userTyping', userData);
  });

  socket.on('stopTyping', () => {
    socket.broadcast.emit('userStopTyping', socket.id);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      console.log(`${user.userName} (${user.userRole}) disconnected`);
      onlineUsers.delete(socket.id);
      userSessions.delete(user.userId);
      io.emit('onlineUsers', Array.from(onlineUsers.values()));
    }
  });
});

// API Routes
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.findAll({
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/messages/unread/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const unreadMessages = await Message.findAll({
      where: {
        recipientId: userId,
        read: false
      },
      include: [{
        model: User,
        as: 'sender',
        attributes: ['userName', 'userRole']
      }],
      order: [['createdAt', 'ASC']]
    });
    res.json(unreadMessages);
  } catch (error) {
    console.error('Error fetching unread messages:', error);
    res.status(500).json({ error: 'Failed to fetch unread messages' });
  }
});

app.post('/api/messages/mark-read', async (req, res) => {
  try {
    const { messageIds } = req.body;
    await Message.update(
      { read: true, readAt: new Date() },
      { where: { id: messageIds } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

app.get('/api/messages/queue/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const queuedMessages = await Message.findAll({
      where: {
        recipientId: userId,
        read: false
      },
      include: [{
        model: User,
        as: 'sender',
        attributes: ['userName', 'userRole']
      }],
      order: [['createdAt', 'ASC']]
    });
    res.json(queuedMessages);
  } catch (error) {
    console.error('Error fetching queued messages:', error);
    res.status(500).json({ error: 'Failed to fetch queued messages' });
  }
});

app.delete('/api/messages/queue/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await Message.update(
      { read: true, readAt: new Date() },
      { where: { recipientId: userId, read: false } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing message queue:', error);
    res.status(500).json({ error: 'Failed to clear message queue' });
  }
});

app.get('/api/users/online', (req, res) => {
  res.json(Array.from(onlineUsers.values()));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    onlineUsers: onlineUsers.size
  });
});

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection and sync models
    await initializeDatabase();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server ready for connections`);
      console.log(`Database: ${isSQLite ? 'SQLite' : 'PostgreSQL'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();