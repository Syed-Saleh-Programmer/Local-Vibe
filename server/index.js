const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// CORS — allow the Vercel frontend and localhost for dev
const ALLOWED_ORIGINS = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'https://localhost:5173', 'https://nzt5fddp-5173.inc1.devtunnels.ms'];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST'],
}));

// Health check endpoint (Render pings this to keep the service alive)
app.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', rooms: rooms.size });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
  // Production optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

// Map to store rooms and participants
// { "cityName": Set(["socketId1", "socketId2"]) }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let currentRoom = null;

  socket.on('join_city', ({ city }) => {
    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      const roomUsers = rooms.get(currentRoom);
      if (roomUsers) {
        roomUsers.delete(socket.id);
        if (roomUsers.size === 0) {
          rooms.delete(currentRoom);
        } else {
          socket.to(currentRoom).emit('user_left', socket.id);
        }
      }
    }

    currentRoom = city;
    socket.join(city);

    if (!rooms.has(city)) {
      rooms.set(city, new Set());
    }
    
    // Get users in the room BEFORE adding the new user
    const usersInRoom = Array.from(rooms.get(city));
    
    rooms.get(city).add(socket.id);

    console.log(`User ${socket.id} joined city: ${city} (${usersInRoom.length + 1} users)`);

    // Inform the new user of all existing users they need to connect to
    socket.emit('all_users', usersInRoom);

    // Inform all other users in the room that a new user joined
    socket.to(city).emit('user_joined', socket.id);
  });

  // WebRTC Signaling
  socket.on('sending_signal', payload => {
    io.to(payload.userToSignal).emit('user_joined_signal', {
      signal: payload.signal,
      callerID: payload.callerID
    });
  });

  socket.on('returning_signal', payload => {
    io.to(payload.callerID).emit('receiving_returned_signal', {
      signal: payload.signal,
      id: socket.id
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (currentRoom) {
      const roomUsers = rooms.get(currentRoom);
      if (roomUsers) {
        roomUsers.delete(socket.id);
        if (roomUsers.size === 0) {
          rooms.delete(currentRoom);
          console.log(`City ${currentRoom} room deleted.`);
        } else {
          socket.to(currentRoom).emit('user_left', socket.id);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // Bind to all interfaces (required for Render/Docker)

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
