// Serveur avec plusieurs salles indépendantes : chaque lien d'invitation
// (ex: http://localhost:3000/?room=abc123) correspond à sa propre salle,
// isolée des autres. Les joueurs d'une salle ne voient que ceux de la même salle.
//
// Démarrage :
//   npm install
//   npm start
// Puis ouvrir http://localhost:3000 : une nouvelle salle est créée automatiquement
// et son lien s'affiche pour être partagé.

const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/callback';

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-moi',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // en production (hébergé en ligne, servi en HTTPS), le cookie de session
    // doit être marqué "secure" ; en local (http://127.0.0.1) on le laisse à false
    secure: process.env.NODE_ENV === 'production'
  }
}));

// nécessaire quand l'app tourne derrière un proxy HTTPS (Render, Railway, etc.)
// pour que express-session détecte correctement une connexion sécurisée
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public')));

// ---- Connexion Spotify (OAuth "Authorization Code") ----

app.get('/login', (req, res) => {
  if (!SPOTIFY_CLIENT_ID) {
    return res.status(500).send('SPOTIFY_CLIENT_ID manquant : vérifie ton fichier .env');
  }
  const state = crypto.randomBytes(8).toString('hex');
  req.session.spotifyState = state;
  // on retient la salle d'où vient la demande, pour y revenir après connexion
  req.session.returnRoom = req.query.room || '';

  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state
  });

  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send('Connexion Spotify refusée ou annulée : ' + error);
  }
  if (!state || state !== req.session.spotifyState) {
    return res.status(400).send('État de connexion invalide (state incorrect). Recommence depuis /login.');
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Erreur échange token Spotify:', errText);
      return res.status(500).send('Échec de la connexion Spotify. Vérifie ton Client ID/Secret et l\'URI de redirection.');
    }

    const tokenData = await tokenRes.json();
    req.session.spotify = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000
    };

    const room = req.session.returnRoom || '';
    res.redirect('/' + (room ? '?room=' + encodeURIComponent(room) : ''));
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur pendant la connexion Spotify.');
  }
});

async function getValidAccessToken(req) {
  const spotify = req.session.spotify;
  if (!spotify) return null;

  if (Date.now() < spotify.expiresAt - 5000) {
    return spotify.accessToken;
  }

  // token expiré : on le rafraîchit avec le refresh token
  const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotify.refreshToken
    })
  });

  if (!refreshRes.ok) return null;

  const data = await refreshRes.json();
  spotify.accessToken = data.access_token;
  spotify.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) spotify.refreshToken = data.refresh_token;

  return spotify.accessToken;
}

app.get('/api/spotify/status', (req, res) => {
  res.json({ connected: !!req.session.spotify });
});

// Jeton d'accès utilisé par le lecteur Spotify intégré (Web Playback SDK) dans le navigateur
app.get('/api/spotify/sdk-token', async (req, res) => {
  const token = await getValidAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Non connecté à Spotify' });
  res.json({ access_token: token });
});

app.get('/api/spotify/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Paramètre "q" manquant' });

  const token = await getValidAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Non connecté à Spotify' });

  try {
    const params = new URLSearchParams({ q, type: 'track', limit: '8' });
    const searchRes = await fetch('https://api.spotify.com/v1/search?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return res.status(searchRes.status).json({ error: errText });
    }

    const data = await searchRes.json();
    const tracks = (data.tracks && data.tracks.items || []).map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      album: t.album.name,
      image: t.album.images[2] || t.album.images[0] || null,
      durationMs: t.duration_ms,
      uri: t.uri
    }));

    res.json({ tracks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la recherche Spotify' });
  }
});

// Tempo et énergie approximative d'un morceau, pour le moteur de lumières
app.get('/api/spotify/track-features/:id', async (req, res) => {
  const token = await getValidAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Non connecté à Spotify' });

  try {
    const featRes = await fetch('https://api.spotify.com/v1/audio-features/' + req.params.id, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!featRes.ok) {
      const errText = await featRes.text();
      return res.status(featRes.status).json({ error: errText });
    }
    const data = await featRes.json();
    res.json({ tempo: data.tempo, energy: data.energy, danceability: data.danceability });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du tempo' });
  }
});

// Toutes les salles actives, indexées par leur code.
// roomId -> { decor, players: { socketId -> {name,x,y,pose,accessory,color} } }
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
    rooms.set(roomId, { decor: 'mainstage', players: {} });
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
  // Le client indique la salle qu'il veut rejoindre (ou vide -> on lui en crée une)
  let currentRoomId = null;

  socket.on('join-room', (requestedRoomId) => {
    // évite qu'un client rejoigne deux salles avec la même connexion
    if (currentRoomId) return;

    currentRoomId = requestedRoomId && String(requestedRoomId).trim()
      ? String(requestedRoomId).trim().slice(0, 20)
      : generateRoomId();

    const room = getOrCreateRoom(currentRoomId);
    socket.join(currentRoomId);

    const playerIndex = Object.keys(room.players).length;
    const player = {
      name: 'Joueur ' + (playerIndex + 1),
      x: 0.5,
      y: 0.6,
      pose: 'idle',
      accessory: 'none',
      color: colorFor(playerIndex)
    };
    room.players[socket.id] = player;

    // envoie l'état complet de la salle (et son code) au nouvel arrivant
    socket.emit('room-state', {
      roomId: currentRoomId,
      decor: room.decor,
      players: room.players,
      currentTrack: room.currentTrack || null,
      selfId: socket.id
    });

    // prévient uniquement les autres joueurs de CETTE salle
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

  socket.on('chat', (text) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    const clean = String(text).slice(0, 140).trim();
    if (!clean) return;
    io.to(currentRoomId).emit('chat-message', { id: socket.id, name: p.name, color: p.color, text: clean });
  });

  // Un joueur choisit un morceau : le serveur donne un "top départ" commun
  // (quelques secondes dans le futur) pour que chaque lecteur Spotify démarre
  // en même temps, malgré les petites différences de latence réseau.
  socket.on('play-track', ({ uri, name, artist }) => {
    if (!currentRoomId || !uri) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const startAt = Date.now() + 3000; // 3 secondes de marge
    room.currentTrack = { uri, name, artist, startAt };
    io.to(currentRoomId).emit('play-track', room.currentTrack);
  });

  socket.on('decor', (decor) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    // n'importe quel joueur peut changer le décor dans ce prototype ;
    // dans la vraie version, seul le DJ (hôte) aurait ce droit.
    room.decor = String(decor).slice(0, 30);
    io.to(currentRoomId).emit('decor-changed', room.decor);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      delete room.players[socket.id];
      io.to(currentRoomId).emit('player-left', { id: socket.id });
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
