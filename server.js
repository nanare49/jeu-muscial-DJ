// Serveur avec plusieurs salles indépendantes + lecture vidéo YouTube synchronisée.
// Aucune connexion (Spotify ou autre) n'est nécessaire : n'importe qui colle un
// lien YouTube et tout le monde dans la salle regarde/écoute au même moment.
//
// Démarrage :
//   npm install
//   npm start
// Puis ouvrir http://localhost:3000 : une nouvelle salle est créée automatiquement
// et son lien s'affiche pour être partagé.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Toutes les salles actives, indexées par leur code.
// roomId -> { decor, players: { socketId -> {...} }, currentVideo }
const rooms = new Map();

const palette = ['#ff5fa3', '#5ad1ff', '#c98bff', '#7ee08a', '#ff9f5a', '#ffd35a'];
function colorFor(index) {
  return palette[index % palette.length];
}

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex'); // ex: "a1b2c3"
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { decor: 'mainstage', players: {}, currentVideo: null });
  }
  return rooms.get(roomId);
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && Object.keys(room.players).length === 0) {
    rooms.delete(roomId);
  }
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join-room', (requestedRoomId) => {
    if (currentRoomId) return;

    currentRoomId = requestedRoomId && String(requestedRoomId).trim()
      ? String(requestedRoomId).trim().slice(0, 20)
      : generateRoomId();

    const room = getOrCreateRoom(currentRoomId);
    socket.join(currentRoomId);

    const isFirstInRoom = Object.keys(room.players).length === 0;
    if (isFirstInRoom) room.djId = socket.id; // le premier arrivant devient le DJ de la salle

    const playerIndex = Object.keys(room.players).length;
    const player = {
      name: 'Joueur ' + (playerIndex + 1),
      x: 0.5,
      y: 0.6,
      pose: 'idle',
      accessory: 'none',
      color: colorFor(playerIndex),
      bubbleStyle: 'plain',       // décor de bulle choisi (festivaliers uniquement)
      bubbleSize: isFirstInRoom ? 1.2 : 1.0 // taille de bulle (réglable par le DJ seulement)
    };
    room.players[socket.id] = player;

    socket.emit('room-state', {
      roomId: currentRoomId,
      decor: room.decor,
      players: room.players,
      currentVideo: room.currentVideo,
      djId: room.djId,
      selfId: socket.id
    });

    socket.to(currentRoomId).emit('player-joined', { id: socket.id, player });
  });

  socket.on('move', (pos) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    p.x = clamp(pos.x, 0, 1);
    p.y = clamp(pos.y, 0, 1);
    socket.to(currentRoomId).emit('player-moved', { id: socket.id, x: p.x, y: p.y });
  });

  socket.on('pose', (pose) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    p.pose = String(pose).slice(0, 30);
    io.to(currentRoomId).emit('player-posed', { id: socket.id, pose: p.pose });
  });

  socket.on('accessory', (accessory) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    p.accessory = String(accessory).slice(0, 30);
    io.to(currentRoomId).emit('player-accessory', { id: socket.id, accessory: p.accessory });
  });

  // Décor de bulle : réservé aux festivaliers (pas au DJ, qui a déjà sa bulle spéciale)
  const allowedBubbleStyles = ['plain', 'dashed', 'stars'];
  socket.on('bubble-style', (style) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p || socket.id === room.djId) return;
    if (!allowedBubbleStyles.includes(style)) return;
    p.bubbleStyle = style;
    io.to(currentRoomId).emit('player-bubble-style', { id: socket.id, style: p.bubbleStyle });
  });

  // Taille de bulle : réservée au DJ, dans une limite raisonnable
  socket.on('bubble-size', (size) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p || socket.id !== room.djId) return;
    const clamped = Math.max(1.0, Math.min(1.6, Number(size) || 1.2));
    p.bubbleSize = clamped;
    io.to(currentRoomId).emit('player-bubble-size', { id: socket.id, size: p.bubbleSize });
  });

  socket.on('chat', (text) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    const clean = String(text).slice(0, 140).trim();
    if (!clean) return;
    io.to(currentRoomId).emit('chat-message', { id: socket.id, name: p.name, color: p.color, text: clean });
  });

  // Permet à chaque client d'estimer l'écart entre son horloge et celle du
  // serveur, pour que le "top départ" des vidéos soit fiable même si l'heure
  // système d'un appareil est décalée.
  socket.on('time-sync', (_, callback) => {
    if (typeof callback === 'function') callback(Date.now());
  });

  // Un joueur colle un lien YouTube : le serveur donne un "top départ" commun
  // (quelques secondes dans le futur) pour que chaque lecteur démarre en même temps.
  socket.on('play-video', ({ videoId, title }) => {
    if (!currentRoomId || !videoId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.currentVideo = {
      videoId,
      title: String(title || '').slice(0, 100),
      paused: false,
      positionSec: 0,
      anchorAt: Date.now() + 6000 // 6 secondes de marge avant le vrai départ
    };
    io.to(currentRoomId).emit('video-state', room.currentVideo);
  });

  // Contrôle de lecture partagé : pause, reprise, avance/retour dans le temps.
  // N'importe qui dans la salle peut agir, comme une vraie régie commune.
  socket.on('video-control', ({ action, positionSec }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const cv = room && room.currentVideo;
    if (!cv) return;

    const actualPos = cv.paused
      ? cv.positionSec
      : cv.positionSec + Math.max(0, Date.now() - cv.anchorAt) / 1000;

    if (action === 'pause') {
      cv.paused = true;
      cv.positionSec = positionSec != null ? positionSec : actualPos;
    } else if (action === 'play') {
      cv.paused = false;
      cv.positionSec = positionSec != null ? positionSec : actualPos;
      cv.anchorAt = Date.now();
    } else if (action === 'seek') {
      cv.positionSec = Math.max(0, positionSec);
      if (!cv.paused) cv.anchorAt = Date.now();
    } else {
      return;
    }

    io.to(currentRoomId).emit('video-state', cv);
  });

  socket.on('decor', (decor) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.decor = String(decor).slice(0, 30);
    io.to(currentRoomId).emit('decor-changed', room.decor);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      delete room.players[socket.id];
      io.to(currentRoomId).emit('player-left', { id: socket.id });

      // si le DJ partait, on transmet le rôle à quelqu'un d'autre encore présent
      if (room.djId === socket.id) {
        const remainingIds = Object.keys(room.players);
        room.djId = remainingIds.length > 0 ? remainingIds[0] : null;
        if (room.djId) {
          room.players[room.djId].bubbleSize = Math.max(room.players[room.djId].bubbleSize, 1.2);
          io.to(currentRoomId).emit('dj-changed', room.djId);
        }
      }

      cleanupRoomIfEmpty(currentRoomId);
    }
  });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

server.listen(PORT, () => {
  console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
