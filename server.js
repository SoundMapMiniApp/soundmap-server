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

const users = {};
const rooms = {}; // комнаты синхронизации

io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);

  // Пользователь зашёл
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
    socket.emit('users:all', Object.values(users));
    socket.broadcast.emit('user:joined', users[socket.id]);
    io.emit('online:count', Object.keys(users).length);
  });

  // Геолокация
  socket.on('location:update', (data) => {
    if(users[socket.id]){
      users[socket.id].lat = data.lat;
      users[socket.id].lng = data.lng;
      socket.broadcast.emit('user:moved', {
        id: socket.id, lat: data.lat, lng: data.lng
      });
    }
  });

  // Трек
  socket.on('track:set', (data) => {
    if(users[socket.id]){
      users[socket.id].track = data.track;
      users[socket.id].artist = data.artist;
      io.emit('user:track', {
        id: socket.id,
        track: data.track,
        artist: data.artist,
      });
    }
  });

  // ══════════════════════════════
  // WebRTC СИГНАЛИЗАЦИЯ
  // ══════════════════════════════

  // Слушатель хочет подключиться к хосту
  socket.on('webrtc:join', ({ hostId }) => {
    const room = 'room:' + hostId;
    socket.join(room);

    if(!rooms[hostId]) rooms[hostId] = new Set();
    rooms[hostId].add(socket.id);

    // Сообщаем хосту что появился новый слушатель
    io.to(hostId).emit('webrtc:listener_joined', {
      listenerId: socket.id,
      name: users[socket.id]?.name || 'Слушатель',
    });

    // Обновляем счётчик слушателей
    io.emit('user:listeners', {
      hostId,
      count: rooms[hostId].size
    });

    console.log(`👂 ${socket.id} подключился к ${hostId}`);
  });

  // Хост отправляет WebRTC offer слушателю
  socket.on('webrtc:offer', ({ to, offer }) => {
    io.to(to).emit('webrtc:offer', {
      from: socket.id,
      offer,
    });
  });

  // Слушатель отвечает хосту WebRTC answer
  socket.on('webrtc:answer', ({ to, answer }) => {
    io.to(to).emit('webrtc:answer', {
      from: socket.id,
      answer,
    });
  });

  // ICE candidates (нужны для WebRTC соединения)
  socket.on('webrtc:ice', ({ to, candidate }) => {
    io.to(to).emit('webrtc:ice', {
      from: socket.id,
      candidate,
    });
  });

  // Слушатель покидает комнату
  socket.on('yt:request_sync', ({ hostId }) => {
    io.to(hostId).emit('yt:request_sync', { from: socket.id });
  });

  socket.on('yt:sync_response', ({ to, videoId, position }) => {
    io.to(to).emit('yt:sync_response', { videoId, position });
  });

  socket.on('yt:position', (data) => {
    const room = 'room:' + socket.id;
    socket.to(room).emit('yt:position', data);
  });socket.on('webrtc:leave', ({ hostId }) => {
    const room = 'room:' + hostId;
    socket.leave(room);
    if(rooms[hostId]){
      rooms[hostId].delete(socket.id);
      io.emit('user:listeners', {
        hostId,
        count: rooms[hostId].size
      });
    }
    io.to(hostId).emit('webrtc:listener_left', {
      listenerId: socket.id
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    // Убираем из всех комнат
    for(const [hostId, listeners] of Object.entries(rooms)){
      if(listeners.has(socket.id)){
        listeners.delete(socket.id);
        io.emit('user:listeners', { hostId, count: listeners.size });
        io.to(hostId).emit('webrtc:listener_left', { listenerId: socket.id });
      }
    }
    // Если хост отключился — закрываем его комнату
    if(rooms[socket.id]){
      const room = 'room:' + socket.id;
      io.to(room).emit('webrtc:host_left');
      delete rooms[socket.id];
    }
    delete users[socket.id];
    io.emit('user:offline', { id: socket.id });
    io.emit('online:count', Object.keys(users).length);
    console.log('Отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('SoundMap сервер запущен на порту', PORT);
});
