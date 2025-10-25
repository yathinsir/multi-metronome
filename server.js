const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('.'));

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        users: [],
        bpm: 120,
        beatsPerBar: 4,
        isRunning: false,
        currentBeat: 0
      };
    }
    const room = rooms[roomCode];
    const isHost = room.users.length === 0;
    room.users.push(socket.id);

    socket.emit('room-joined', {
      isHost,
      bpm: room.bpm,
      beatsPerBar: room.beatsPerBar
    });

    updateUserCount(roomCode);
  });

  socket.on('start-metronome', ({ bpm, beatsPerBar }) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (room.users[0] !== socket.id) return; // 只有 host

    room.bpm = bpm;
    room.beatsPerBar = beatsPerBar;
    room.isRunning = true;
    room.currentBeat = 0;

    let beat = 0;
    const interval = 60000 / bpm;
    room.intervalId = setInterval(() => {
      io.to(roomCode).emit('beat', beat);
      beat = (beat + 1) % beatsPerBar;
      room.currentBeat = beat;
    }, interval);

    io.to(roomCode).emit('update-state', {
      bpm, beatsPerBar, isRunning: true, currentBeat: 0
    });
  });

  socket.on('stop-metronome', () => {
    const roomCode = getRoomCode(socket);
    if (!roomCode || rooms[roomCode].users[0] !== socket.id) return;
    stopRoom(roomCode);
  });

  socket.on('update-bpm', (bpm) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode || rooms[roomCode].users[0] !== socket.id) return;
    rooms[roomCode].bpm = bpm;
    io.to(roomCode).emit('update-state', { bpm, beatsPerBar: rooms[roomCode].beatsPerBar });
  });

  socket.on('update-timeSig', (beats) => {
    const roomCode = getRoomCode(socket);
    if (!roomCode || rooms[roomCode].users[0] !== socket.id) return;
    rooms[roomCode].beatsPerBar = beats;
    io.to(roomCode).emit('update-state', { bpm: rooms[roomCode].bpm, beatsPerBar: beats });
  });

  socket.on('leave-room', (roomCode) => {
    leaveRoom(socket, roomCode);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].users.includes(socket.id)) {
        leaveRoom(socket, code);
        break;
      }
    }
  });
});

function getRoomCode(socket) {
  for (const [code, room] of Object.entries(rooms)) {
    if (room.users.includes(socket.id)) return code;
  }
  return null;
}

function leaveRoom(socket, roomCode) {
  if (!rooms[roomCode]) return;
  rooms[roomCode].users = rooms[roomCode].users.filter(id => id !== socket.id);
  updateUserCount(roomCode);
  if (rooms[roomCode].users.length === 0) {
    stopRoom(roomCode);
    delete rooms[roomCode];
  } else if (rooms[roomCode].users[0] === socket.id) {
    stopRoom(roomCode);
  }
}

function stopRoom(roomCode) {
  if (rooms[roomCode].intervalId) {
    clearInterval(rooms[roomCode].intervalId);
  }
  rooms[roomCode].isRunning = false;
  io.to(roomCode).emit('update-state', {
    isRunning: false,
    bpm: rooms[roomCode].bpm,
    beatsPerBar: rooms[roomCode].beatsPerBar
  });
}

function updateUserCount(roomCode) {
  io.to(roomCode).emit('user-count', rooms[roomCode].users.length);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});