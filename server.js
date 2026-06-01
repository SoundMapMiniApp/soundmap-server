require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Храним пользователей в памяти
const users = {};

io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);

  // Пользователь отправил свои данные
  socket.on('user:join', (data) => {
    users[socket.id] = {
      id: socket.id,
      name: data.name,
      emoji: data.emoji || '🎵',
      lat: data.lat,
      lng: data.lng,
      track: '',
      artist: '',
    };
    // Отправляем новому пользователю всех онлайн
    socket.emit('users:all', Object.values(users));
    // Сообщаем всем что появился новый
    socket.broadcast.emit('user:joined', users[socket.id]);
    // Обновляем счётчик
    io.emit('online:count', Object.keys(users).length);
  });

  // Пользователь обновил позицию
  socket.on('location:update', (data) => {
    if (users[socket.id]) {
      users[socket.id].lat = data.lat;
      users[socket.id].lng = data.lng;
      socket.broadcast.emit('user:moved', {
        id: socket.id,
        lat: data.lat,
        lng: data.lng,
      });
    }
  });

  // Пользователь поставил трек
  socket.on('track:set', (data) => {
    if (users[socket.id]) {
      users[socket.id].track = data.track;
      users[socket.id].artist = data.artist;
      io.emit('user:track', {
        id: socket.id,
        track: data.track,
        artist: data.artist,
      });
    }
  });

  // Синхронизация
  socket.on('sync:join', (data) => {
    const room = 'sync:' + data.targetId;
    socket.join(room);
    const host = users[data.targetId];
    if (host) {
      socket.emit('sync:start', {
        track: host.track,
        artist: host.artist,
        startedAt: Date.now(),
      });
    }
    const count = io.sockets.adapter.rooms.get(room)?.size || 1;
    io.to(room).emit('sync:listeners', { hostId: data.targetId, count });
  });

  // Отключение
  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('user:offline', { id: socket.id });
    io.emit('online:count', Object.keys(users).length);
    console.log('Отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('SoundMap сервер запущен на порту', PORT);
});
