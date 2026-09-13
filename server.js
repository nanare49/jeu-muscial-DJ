// Serveur avec plusieurs salles indépendantes + lecture vidéo YouTube synchronisée.
// Aucune connexion (Spotify ou autre) n'est nécessaire : n'importe qui colle un
// lien YouTube et tout le monde dans la salle regarde/écoute au même moment.
//
// Démarrage :
//   npm install
//   npm start
// Puis ouvrir http://localhost:3000 : une nouvelle salle est créée automatiquement
// et son lien s'affiche pour être partagé.

const fs = require('fs');
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

// --- Profils persistants des joueurs (XP, pièces, objets achetés) ---
// Identifiés par un "token" généré et gardé par chaque navigateur (localStorage),
// PAS par un vrai compte : quelqu'un qui copie son token sur un autre appareil
// partagerait le même profil, mais il n'y a pas de mot de passe à retenir.
// Sauvegardés dans un simple fichier JSON : ça survit aux reconnexions et aux
// redémarrages du serveur, mais pas à un redéploiement sur un hébergeur dont le
// disque est réinitialisé à chaque déploiement (c'est le cas sur Render).
const PROFILES_FILE = path.join(__dirname, 'data', 'profiles.json');
let profiles = {};
try {
  if (fs.existsSync(PROFILES_FILE)) {
    profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Impossible de lire les profils sauvegardés :', e.message);
  profiles = {};
}
let profileSaveScheduled = false;
function scheduleSaveProfiles() {
  if (profileSaveScheduled) return;
  profileSaveScheduled = true;
  setTimeout(() => {
    profileSaveScheduled = false;
    try {
      fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
    } catch (e) {
      console.error('Impossible de sauvegarder les profils :', e.message);
    }
  }, 2000);
}

const XP_PER_LEVEL = 100;
function levelForXp(xp) {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

function isValidToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

function getOrCreateProfile(token) {
  if (!profiles[token]) {
    profiles[token] = {
      xp: 0,
      coins: 0,
      ownedItems: []
    };
  }
  return profiles[token];
}

function publicProfile(token) {
  const p = getOrCreateProfile(token);
  return {
    xp: p.xp,
    coins: p.coins,
    level: levelForXp(p.xp),
    xpIntoLevel: p.xp % XP_PER_LEVEL,
    xpPerLevel: XP_PER_LEVEL,
    ownedItems: p.ownedItems
  };
}

// --- Mini-jeu de ramassage d'objets sur la piste, pendant qu'un morceau tourne ---
// Chaque type d'objet a un effet bonus ou malus. Les effets "de statut" (vitesse,
// ralenti, immobilisation, touches inversées, vision trouble) durent au plus 5s
// puis disparaissent tout seuls ; les gains/pertes de pièces ou d'XP sont
// instantanés. Un objet ramassé disparaît puis en fait réapparaître un nouveau
// ailleurs sur la piste après un court délai.
const ITEM_TYPES = {
  coin:      { kind: 'bonus', emoji: '🪙', effect: 'coins' },
  discoball: { kind: 'bonus', emoji: '🪩', effect: 'xp' },
  sneaker:   { kind: 'bonus', emoji: '👟', effect: 'speed' },
  vip:       { kind: 'bonus', emoji: '🎫', effect: 'slow_opponent' },
  baton:     { kind: 'bonus', emoji: '🥊', effect: 'push_opponent' },
  cocktail:  { kind: 'malus', emoji: '🍸', effect: 'blurred' },
  syringe:   { kind: 'malus', emoji: '💉', effect: 'inverted' },
  vinyl:     { kind: 'malus', emoji: '💿', effect: 'frozen' },
  security:  { kind: 'malus', emoji: '👮', effect: 'lose_coins' }
};
const ITEM_TYPE_KEYS = Object.keys(ITEM_TYPES);
const ROUND_INITIAL_ITEMS = 7;
const ROUND_RESPAWN_MIN_MS = 3000;
const ROUND_RESPAWN_MAX_MS = 6000;
const STATUS_EFFECT_MS = 5000;
const ITEM_PICKUP_RADIUS = 0.035;
const OPPONENT_MAX_RADIUS = 0.35;
const ITEM_PICKUP_COOLDOWN_MS = 120;

// Case la plus basse (fraction 0..1) jusqu'où on peut placer un objet ou une
// case disco : chaque navigateur signale sa propre limite de la piste (juste
// sous sa barrière) à la connexion, et on retient la plus restrictive de tous
// pour être sûr qu'aucun bonus/malus ne tombe sur la barrière, hors d'atteinte.
const DEFAULT_FLOOR_MIN_Y = 0.62;
function isValidFloorMinY(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0.3 && v <= 0.85;
}

// --- piste lumineuse façon dancefloor disco : toute la piste est quadrillée
// de cases éteintes, dont certaines s'allument de temps en temps dans une
// couleur au hasard, et rapportent 1 à 5 pièces à qui marche dessus (elle
// s'éteint alors, jusqu'à ce qu'une autre s'allume ailleurs). ---
const DISCO_GRID_COLS = 14;
const DISCO_GRID_ROWS = 5;
const DISCO_TILE_INTERVAL_MIN_MS = 1200;
const DISCO_TILE_INTERVAL_MAX_MS = 2600;
const DISCO_TILE_MAX_LIT = 3;
const DISCO_TILE_PICKUP_RADIUS = 0.045;
const DISCO_TILE_COLORS = ['#ff4d6d', '#4ade80', '#4da6ff', '#c084fc', '#ff5fa3', '#33e6e6', '#ff8c3d', '#ffd35a'];

// --- ambiance musicale simulée : comme le jeu lit la musique via une vidéo
// YouTube intégrée, son signal audio réel n'est pas accessible (restriction
// cross-origin de l'iframe) — impossible d'analyser le rythme pour de vrai.
// On simule donc un tempo (BPM) et des "drops" à intervalles aléatoires,
// calés sur le même "top départ" (anchorAt) que la vidéo pour que tout le
// monde les vive exactement au même moment. ---
const MUSIC_PULSE_BPM_MIN = 100;
const MUSIC_PULSE_BPM_MAX = 132;
const MUSIC_DROP_MIN_MS = 22000;
const MUSIC_DROP_MAX_MS = 42000;
const MUSIC_DROP_LEAD_MS = 3000; // marge avant le drop pour que tout le monde le déclenche ensemble
const MUSIC_DROP_STROBE_MS = 1400;

// --- effets lumineux automatiques : si le DJ ne veut pas piloter la régie
// lui-même, le serveur fait vivre les effets à intervalles réguliers, comme
// un "auto-VJ" (changement de couleurs/style aléatoire, façon boîte de nuit). ---
const AUTO_LIGHTS_MIN_MS = 2500;
const AUTO_LIGHTS_MAX_MS = 5000;
const AUTO_LIGHT_COLORS = ['#ff5fa3', '#5ad1ff', '#ffd35a', '#4ade80', '#c084fc', '#ff8c3d', '#33e6e6', '#ff4d6d'];

// Catalogue de la boutique : objets cosmétiques achetables avec les pièces
// gagnées en jouant. `slot: 'accessory'` réutilise le système d'accessoires
// existant (aucun changement de valeur ne casse les accessoires gratuits).
const SHOP_ITEMS = [
  { id: 'acc_shades', slot: 'accessory', label: 'Lunettes de soleil', emoji: '😎', price: 30 },
  { id: 'acc_halo', slot: 'accessory', label: 'Auréole', emoji: '😇', price: 60 },
  { id: 'acc_wings', slot: 'accessory', label: 'Ailes', emoji: '🦋', price: 90 },
  { id: 'acc_disco', slot: 'accessory', label: 'Masque disco', emoji: '🕺', price: 120 }
];
const shopItemsById = new Map(SHOP_ITEMS.map(item => [item.id, item]));
const freeAccessories = ['none', 'cap', 'hat', 'buoy', 'costume'];

function canUseAccessory(token, accessoryId) {
  if (freeAccessories.includes(accessoryId)) return true;
  const item = shopItemsById.get(accessoryId);
  if (!item || item.slot !== 'accessory') return false;
  const profile = getOrCreateProfile(token);
  return profile.ownedItems.includes(accessoryId);
}

const palette = ['#ff5fa3', '#5ad1ff', '#c98bff', '#7ee08a', '#ff9f5a', '#ffd35a'];
function colorFor(index) {
  return palette[index % palette.length];
}

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex'); // ex: "a1b2c3"
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      decor: 'mainstage',
      players: {},
      currentVideo: null,
      creatorId: null,
      djMode: 'fixed', // 'fixed' (le créateur reste DJ) ou 'queue' (file d'attente façon plug.dj)
      djQueue: [],      // liste d'ids en attente de leur tour, en mode 'queue'
      // Passage DJ en cours : remis à zéro à chaque nouveau passage (cf. settleDjTurn).
      currentDjTurn: { settled: false },
      // Case la plus basse (fraction 0..1) où placer un objet/une case disco,
      // affinée au fil des connexions par le "minY" que chaque navigateur
      // signale (cf. isValidFloorMinY) — jamais rien sur la barrière.
      floorMinY: DEFAULT_FLOOR_MIN_Y,
      // Mini-jeu de ramassage d'objets sur la piste, actif pendant qu'un morceau tourne.
      round: {
        items: {},          // id -> { id, type, x, y }
        nextItemId: 1,
        discoTiles: [],      // grille de cases lumineuses (cf. buildDiscoGrid)
        active: false,       // true une fois le décompte terminé (les objets sont ramassables)
        countdownEndAt: null, // timestamp commun (cf. anchorAt de la vidéo) du "top départ"
        timers: []           // setTimeout en cours pour ce round (annulés si le round s'arrête avant)
      },
      // Rythme simulé (BPM + ancrage commun) utilisé pour faire vibrer/assombrir
      // la piste en rythme et déclencher les stroboscopes de "drop", pendant
      // qu'un morceau tourne (cf. commentaire sur MUSIC_PULSE_BPM_MIN plus haut).
      musicPulse: { bpm: null, anchorAt: null },
      autoLightsRunning: false, // évite de lancer deux boucles d'auto-VJ en parallèle
      lightEffects: {
        flash: { on: false, color: '#ff5fa3' },
        laser: { on: false, color: '#5ad1ff', count: 4, style: 'rotating' },
        fireballs: { on: false, color: '#ff7a3d', count: 2 },
        sparks: { on: false, color: '#ffd35a', count: 4, intensity: 0.6 },
        discoball: { on: false, color: '#ffffff' },
        power: 0.6,
        speed: 1.0,
        // si activé, le serveur pilote lui-même les effets ci-dessus au rythme
        // de la musique (cf. scheduleAutoLightsTick) et les contrôles manuels
        // du DJ sont ignorés jusqu'à ce qu'il désactive ce mode.
        autoMode: false
      }
    });
  }
  return rooms.get(roomId);
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && Object.keys(room.players).length === 0) {
    rooms.delete(roomId);
  }
}

const allowedAvatarTypes = ['human', 'robot', 'alien', 'ghost', 'dragon', 'blob'];
const allowedAvatarColors = ['#ff5fa3', '#5ad1ff', '#ffd35a'];

// Le token d'un joueur donne accès à son profil (XP/pièces/objets) : il ne doit
// JAMAIS être envoyé aux autres clients, seulement gardé côté serveur et renvoyé
// au joueur concerné lui-même (dans room-state, une seule fois, à sa connexion).
function sanitizePlayerForClients(player) {
  const { token, ...rest } = player;
  return rest;
}
function sanitizePlayersForClients(players) {
  const out = {};
  for (const id of Object.keys(players)) out[id] = sanitizePlayerForClients(players[id]);
  return out;
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join-room', (payload) => {
    if (currentRoomId) return;

    // accepte l'ancien format (juste une chaîne = code de salle) et le nouveau
    // format objet avec le choix d'avatar fait sur l'écran de sélection
    const requestedRoomId = typeof payload === 'string' ? payload : (payload && payload.roomId);
    const requestedAvatarType = payload && typeof payload === 'object' ? payload.avatarType : null;
    const requestedAvatarColor = payload && typeof payload === 'object' ? payload.avatarColor : null;
    const requestedName = payload && typeof payload === 'object' ? String(payload.name || '').trim().slice(0, 20) : '';
    const requestedToken = payload && typeof payload === 'object' ? payload.token : null;
    // Le token identifie le profil persistant (XP/pièces/objets) de ce navigateur.
    // S'il est absent ou invalide (première visite, ancien client...), on en génère
    // un nouveau et on le renvoie au client pour qu'il le garde en mémoire.
    const token = isValidToken(requestedToken) ? requestedToken : crypto.randomUUID();
    const requestedMinY = payload && typeof payload === 'object' ? Number(payload.minY) : NaN;

    currentRoomId = requestedRoomId && String(requestedRoomId).trim()
      ? String(requestedRoomId).trim().slice(0, 20)
      : generateRoomId();

    const room = getOrCreateRoom(currentRoomId);
    socket.join(currentRoomId);

    // ce navigateur nous dit jusqu'où sa propre barrière laisse marcher : on ne
    // devient jamais moins strict, pour ne jamais faire apparaître un bonus/malus
    // hors d'atteinte chez quelqu'un dont l'écran laisse moins de place.
    if (isValidFloorMinY(requestedMinY)) {
      room.floorMinY = Math.max(room.floorMinY, requestedMinY);
    }

    const isFirstInRoom = Object.keys(room.players).length === 0;
    if (isFirstInRoom) {
      room.djId = socket.id; // le premier arrivant devient le DJ de la salle
      room.creatorId = socket.id; // lui seul pourra choisir le mode DJ unique / file d'attente
    }

    const playerIndex = Object.keys(room.players).length;
    const player = {
      name: requestedName || ('Joueur ' + (playerIndex + 1)),
      x: 0.5,
      y: 0.6,
      pose: isFirstInRoom ? 'dj_behind' : 'idle',
      accessory: 'none',
      color: colorFor(playerIndex),
      avatarType: allowedAvatarTypes.includes(requestedAvatarType) ? requestedAvatarType : 'human',
      avatarColor: allowedAvatarColors.includes(requestedAvatarColor) ? requestedAvatarColor : allowedAvatarColors[0],
      bubbleStyle: 'plain',       // décor de bulle choisi (festivaliers uniquement)
      bubbleSize: isFirstInRoom ? 1.2 : 1.0, // taille de bulle (réglable par le DJ seulement)
      // pièces déjà en poche à l'arrivée (ou au début du round) : le malus "perte de
      // pièces" du mini-jeu ne peut jamais faire descendre en dessous de ce plancher.
      roundStartCoins: getOrCreateProfile(token).coins,
      statusEffect: null,
      token
    };
    room.players[socket.id] = player;

    socket.emit('room-state', {
      roomId: currentRoomId,
      decor: room.decor,
      players: sanitizePlayersForClients(room.players),
      currentVideo: room.currentVideo,
      djId: room.djId,
      creatorId: room.creatorId,
      djMode: room.djMode,
      djQueue: room.djQueue,
      lightEffects: room.lightEffects,
      round: {
        active: room.round.active,
        items: Object.values(room.round.items),
        discoTiles: room.round.discoTiles,
        countdownEndAt: room.round.countdownEndAt,
        musicPulse: room.musicPulse
      },
      selfId: socket.id,
      token,
      profile: publicProfile(token),
      shopCatalog: SHOP_ITEMS
    });

    socket.to(currentRoomId).emit('player-joined', { id: socket.id, player: sanitizePlayerForClients(player) });
  });

  socket.on('move', (pos) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    p.x = clamp(pos.x, 0, 1);
    p.y = clamp(pos.y, 0, 1);
    socket.to(currentRoomId).emit('player-moved', { id: socket.id, x: p.x, y: p.y });
    if (room.round.active && socket.id !== room.djId) {
      checkItemPickup(room, currentRoomId, socket.id, p);
      checkDiscoTilePickup(room, currentRoomId, socket.id, p);
    }
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
    const requested = String(accessory).slice(0, 30);
    if (!canUseAccessory(p.token, requested)) return; // objet payant non possédé : on ignore
    p.accessory = requested;
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

  // Le créateur de la salle choisit : DJ unique (par défaut) ou file d'attente façon plug.dj
  socket.on('set-dj-mode', (mode) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.creatorId) return;
    room.djMode = mode === 'queue' ? 'queue' : 'fixed';
    if (room.djMode === 'fixed') room.djQueue = [];
    io.to(currentRoomId).emit('dj-mode-changed', { mode: room.djMode, queue: room.djQueue });
  });

  socket.on('join-dj-queue', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.djMode !== 'queue') return;
    if (socket.id === room.djId) return; // déjà DJ, pas besoin de faire la queue
    if (!room.djQueue.includes(socket.id)) room.djQueue.push(socket.id);
    io.to(currentRoomId).emit('dj-queue-changed', room.djQueue);
  });

  socket.on('leave-dj-queue', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.djQueue = room.djQueue.filter(id => id !== socket.id);
    io.to(currentRoomId).emit('dj-queue-changed', room.djQueue);
  });

  // Le DJ actuel décide de passer la main tout de suite (bouton "Passer la main") :
  // on solde d'abord son passage (notes -> XP/pièces), puis on avance la file.
  socket.on('next-dj', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.djMode !== 'queue' || socket.id !== room.djId) return;
    settleDjTurn(room, currentRoomId);
    advanceDjQueue(room, currentRoomId);
  });

  // Une vidéo vient de se terminer chez le DJ actuel : on solde son passage dans
  // tous les cas (même en mode DJ unique, où il reste DJ mais touche quand même
  // la récompense de ce morceau), et on avance la file seulement en mode 'queue'.
  socket.on('video-ended', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    settleDjTurn(room, currentRoomId);
    if (room.djMode === 'queue') advanceDjQueue(room, currentRoomId);
  });

  // Achat d'un objet de la boutique avec les pièces gagnées en jouant.
  socket.on('buy-item', (itemId) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    const item = shopItemsById.get(String(itemId));
    if (!item) return;
    const profile = getOrCreateProfile(p.token);
    if (profile.ownedItems.includes(item.id)) return; // déjà possédé
    if (profile.coins < item.price) return; // pas assez de pièces
    profile.coins -= item.price;
    profile.ownedItems.push(item.id);
    scheduleSaveProfiles();
    socket.emit('profile-updated', publicProfile(p.token));
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
  // Réservé au DJ actuel de la salle.
  socket.on('play-video', ({ videoId, title }) => {
    if (!currentRoomId || !videoId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    room.currentVideo = {
      videoId,
      title: String(title || '').slice(0, 100),
      paused: false,
      positionSec: 0,
      anchorAt: Date.now() + 6000 // 6 secondes de marge avant le vrai départ
    };
    io.to(currentRoomId).emit('video-state', room.currentVideo);
    // le mini-jeu de ramassage démarre en même temps que la musique : le décompte
    // affiché à tout le monde vise ce même "top départ" (anchorAt).
    startRoundCountdown(room, currentRoomId);
  });

  // Contrôle de lecture (pause, reprise, avance/retour) : réservé au DJ actuel,
  // comme une vraie régie que lui seul manie.
  socket.on('video-control', ({ action, positionSec }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    const cv = room.currentVideo;
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

  // Décor de scène : réservé au DJ actuel, comme le reste de la régie
  socket.on('decor', (decor) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    room.decor = String(decor).slice(0, 30);
    io.to(currentRoomId).emit('decor-changed', room.decor);
  });

  // Effets lumineux : réservés au DJ, comme le reste de la régie.
  // On reçoit l'état complet à chaque changement (case cochée, curseur bougé, couleur choisie).
  // Si le mode auto est actif, on ignore les réglages manuels (sauf la
  // désactivation du mode auto lui-même) : c'est la régie automatique qui a la main.
  socket.on('set-light-effects', (payload) => {
    if (!currentRoomId || !payload) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    const wasAuto = room.lightEffects.autoMode;
    const requestedAuto = !!payload.autoMode;
    if (wasAuto && requestedAuto) return; // la régie auto garde la main, rien à changer ici
    room.lightEffects = sanitizeLightEffects(payload, room.lightEffects);
    io.to(currentRoomId).emit('light-effects-changed', room.lightEffects);
    if (!wasAuto && requestedAuto && room.round.active && !room.autoLightsRunning) {
      scheduleAutoLightsTick(room, currentRoomId);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      // si le DJ partait, on solde son passage (notes -> XP/pièces) AVANT de
      // supprimer son profil de joueur de la salle, sinon on perdrait son token
      if (room.djId === socket.id) settleDjTurn(room, currentRoomId);

      const leavingPlayer = room.players[socket.id];
      if (leavingPlayer && leavingPlayer.effectTimer) clearTimeout(leavingPlayer.effectTimer);
      delete room.players[socket.id];
      room.djQueue = room.djQueue.filter(id => id !== socket.id);
      io.to(currentRoomId).emit('player-left', { id: socket.id });

      // si le DJ partait, on transmet le rôle : à la file d'attente si elle existe,
      // sinon à n'importe qui d'autre encore présent
      if (room.djId === socket.id) {
        const advanced = room.djMode === 'queue' && advanceDjQueue(room, currentRoomId);
        if (!advanced) {
          const remainingIds = Object.keys(room.players);
          room.djId = remainingIds.length > 0 ? remainingIds[0] : null;
          if (room.djId) {
            room.players[room.djId].bubbleSize = Math.max(room.players[room.djId].bubbleSize, 1.2);
            room.players[room.djId].pose = 'dj_behind';
            io.to(currentRoomId).emit('dj-changed', room.djId);
            io.to(currentRoomId).emit('player-posed', { id: room.djId, pose: 'dj_behind' });
          }
        }
      }

      // si le créateur partait, la salle n'a plus personne pour changer le mode DJ —
      // ce n'est pas grave, le mode déjà choisi continue de s'appliquer tel quel

      cleanupRoomIfEmpty(currentRoomId);
    }
  });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const validLaserStyles = ['rotating', 'fan', 'cross'];
function isHexColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}
function sanitizeLightEffects(payload, previous) {
  const power = Number(payload.power);
  const speed = Number(payload.speed);
  const laserIn = payload.laser || {};
  const laserCountRaw = Math.round(Number(laserIn.count));
  const sparksIn = payload.sparks || {};
  const sparksCountRaw = Math.round(Number(sparksIn.count));
  const sparksIntensity = Number(sparksIn.intensity);
  const fireballsIn = payload.fireballs || {};
  const validFireballsCounts = [2, 4, 6, 8];
  const fireballsCountRaw = Math.round(Number(fireballsIn.count));
  return {
    flash: {
      on: !!(payload.flash && payload.flash.on),
      color: isHexColor(payload.flash && payload.flash.color) ? payload.flash.color : previous.flash.color
    },
    laser: {
      on: !!laserIn.on,
      color: isHexColor(laserIn.color) ? laserIn.color : previous.laser.color,
      count: Number.isFinite(laserCountRaw) ? clamp(laserCountRaw, 1, 8) : previous.laser.count,
      style: validLaserStyles.includes(laserIn.style) ? laserIn.style : previous.laser.style
    },
    fireballs: {
      on: !!fireballsIn.on,
      color: isHexColor(fireballsIn.color) ? fireballsIn.color : previous.fireballs.color,
      count: validFireballsCounts.includes(fireballsCountRaw) ? fireballsCountRaw : (previous.fireballs.count || 2)
    },
    sparks: {
      on: !!sparksIn.on,
      color: isHexColor(sparksIn.color) ? sparksIn.color : previous.sparks.color,
      count: Number.isFinite(sparksCountRaw) ? clamp(sparksCountRaw, 4, 10) : previous.sparks.count,
      intensity: Number.isFinite(sparksIntensity) ? clamp(sparksIntensity, 0, 1) : previous.sparks.intensity
    },
    discoball: {
      on: !!(payload.discoball && payload.discoball.on),
      color: isHexColor(payload.discoball && payload.discoball.color) ? payload.discoball.color : previous.discoball.color
    },
    power: Number.isFinite(power) ? clamp(power, 0, 1) : previous.power,
    speed: Number.isFinite(speed) ? clamp(speed, 0.3, 2.5) : previous.speed,
    autoMode: !!payload.autoMode
  };
}

// Petite régie automatique : tant que le DJ a activé le mode auto ET qu'un
// morceau tourne, on change les effets lumineux à intervalles aléatoires
// (façon VJ qui suit l'ambiance), sans jamais toucher à `autoMode` lui-même.
// La chaîne s'arrête toute seule (ne se reprogramme pas) dès que le round
// s'arrête ou que le DJ repasse en contrôle manuel.
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function scheduleAutoLightsTick(room, roomId) {
  room.autoLightsRunning = true;
  const delay = AUTO_LIGHTS_MIN_MS + Math.random() * (AUTO_LIGHTS_MAX_MS - AUTO_LIGHTS_MIN_MS);
  const timer = setTimeout(() => {
    if (rooms.get(roomId) !== room || !room.round.active || !room.lightEffects.autoMode) {
      room.autoLightsRunning = false;
      return;
    }
    room.lightEffects = {
      flash: { on: Math.random() < 0.7, color: pick(AUTO_LIGHT_COLORS) },
      laser: {
        on: Math.random() < 0.6,
        color: pick(AUTO_LIGHT_COLORS),
        count: 2 + Math.floor(Math.random() * 6),
        style: pick(validLaserStyles)
      },
      fireballs: {
        on: Math.random() < 0.5,
        color: pick(AUTO_LIGHT_COLORS),
        count: pick([2, 4, 6, 8])
      },
      sparks: {
        on: Math.random() < 0.5,
        color: pick(AUTO_LIGHT_COLORS),
        count: 4 + Math.floor(Math.random() * 6),
        intensity: 0.3 + Math.random() * 0.7
      },
      discoball: { on: Math.random() < 0.8, color: pick(AUTO_LIGHT_COLORS) },
      power: 0.4 + Math.random() * 0.6,
      speed: 0.6 + Math.random() * 1.4,
      autoMode: true
    };
    io.to(roomId).emit('light-effects-changed', room.lightEffects);
    scheduleAutoLightsTick(room, roomId);
  }, delay);
  room.round.timers.push(timer);
}

// Fait passer la main au prochain de la file d'attente, s'il y en a un.
// Retourne true si un changement de DJ a eu lieu.
// Calcule la récompense forfaitaire du passage DJ qui vient de se terminer,
// prévient tout le monde du résultat, arrête le mini-jeu de ramassage en cours
// (cf. endRound), puis remet le passage à zéro pour le suivant. Ne fait rien
// si ce passage a déjà été soldé (protège contre un double déclenchement, ex.
// "passer la main" juste après la fin de vidéo).
function settleDjTurn(room, roomId) {
  const turn = room.currentDjTurn;
  if (!turn || turn.settled) return;
  turn.settled = true;

  const djPlayer = room.players[room.djId];
  // Les festivaliers gagnent maintenant leur XP/pièces en ramassant des objets
  // sur la piste (cf. mini-jeu ci-dessous) ; le DJ touche une petite récompense
  // forfaitaire à chaque passage terminé, pour rester incitatif à passer platines.
  const DJ_TURN_XP = 50, DJ_TURN_COINS = 15;

  let djResult = null;
  if (djPlayer && djPlayer.token) {
    const profile = getOrCreateProfile(djPlayer.token);
    const levelBefore = levelForXp(profile.xp);
    profile.xp += DJ_TURN_XP;
    profile.coins += DJ_TURN_COINS;
    const levelAfter = levelForXp(profile.xp);
    djResult = {
      name: djPlayer.name,
      xpGain: DJ_TURN_XP,
      coinsGain: DJ_TURN_COINS,
      level: levelAfter,
      leveledUp: levelAfter > levelBefore
    };
    io.to(room.djId).emit('profile-updated', publicProfile(djPlayer.token));
  }

  if (djResult) io.to(roomId).emit('dj-turn-result', djResult);

  endRound(room, roomId);
  scheduleSaveProfiles();
  room.currentDjTurn = { settled: false };
}

// --- mini-jeu de ramassage d'objets sur la piste ---

function clearRoundTimers(room) {
  room.round.timers.forEach(t => clearTimeout(t));
  room.round.timers = [];
}

// Choisit une position aléatoire dans la zone de la piste où TOUT LE MONDE
// peut marcher (cf. room.floorMinY) : jamais sur la barrière ni hors d'atteinte.
function randomFloorPosition(room) {
  const yMin = room.floorMinY;
  const yMax = 0.9;
  return {
    x: 0.08 + Math.random() * 0.84,
    y: yMin + Math.random() * Math.max(0.05, yMax - yMin)
  };
}

function spawnItem(room) {
  const type = ITEM_TYPE_KEYS[Math.floor(Math.random() * ITEM_TYPE_KEYS.length)];
  const id = room.round.nextItemId++;
  const pos = randomFloorPosition(room);
  const item = { id, type, x: pos.x, y: pos.y };
  room.round.items[id] = item;
  return item;
}

function broadcastRoundItems(room, roomId) {
  io.to(roomId).emit('round-items', Object.values(room.round.items));
}

// Construit une grille de cases disco qui remplit toute la piste atteignable
// (mêmes bornes que randomFloorPosition), toutes éteintes au départ.
function buildDiscoGrid(room) {
  const xMin = 0.08, xMax = 0.92;
  const yMin = Math.min(0.86, room.floorMinY + 0.03), yMax = 0.92;
  const tiles = [];
  let id = 1;
  for (let r = 0; r < DISCO_GRID_ROWS; r++) {
    for (let c = 0; c < DISCO_GRID_COLS; c++) {
      const x = xMin + (c + 0.5) * (xMax - xMin) / DISCO_GRID_COLS;
      const y = yMin + (r + 0.5) * (yMax - yMin) / DISCO_GRID_ROWS;
      tiles.push({ id: id++, x, y, lit: false, color: null });
    }
  }
  room.round.discoTiles = tiles;
}

function broadcastDiscoTiles(room, roomId) {
  io.to(roomId).emit('disco-tiles', room.round.discoTiles);
}

// Allume une case éteinte au hasard dans une couleur tirée au sort (pas
// toujours la même, façon vraie piste disco multicolore), tant qu'il n'y en
// a pas déjà trop d'allumées en même temps, puis se reprogramme pour la
// prochaine fois.
function lightRandomDiscoTile(room, roomId) {
  const tiles = room.round.discoTiles;
  if (!tiles.length) return;
  const litCount = tiles.filter(t => t.lit).length;
  if (litCount < DISCO_TILE_MAX_LIT) {
    const offTiles = tiles.filter(t => !t.lit);
    if (offTiles.length > 0) {
      const tile = offTiles[Math.floor(Math.random() * offTiles.length)];
      tile.lit = true;
      tile.color = pick(DISCO_TILE_COLORS);
      broadcastDiscoTiles(room, roomId);
    }
  }
}

function scheduleDiscoTileTick(room, roomId) {
  const delay = DISCO_TILE_INTERVAL_MIN_MS + Math.random() * (DISCO_TILE_INTERVAL_MAX_MS - DISCO_TILE_INTERVAL_MIN_MS);
  const timer = setTimeout(() => {
    if (rooms.get(roomId) !== room || !room.round.active) return;
    lightRandomDiscoTile(room, roomId);
    scheduleDiscoTileTick(room, roomId);
  }, delay);
  room.round.timers.push(timer);
}

// Programme le prochain "drop" simulé : un signal envoyé à l'avance (cf.
// MUSIC_DROP_LEAD_MS) pour que tout le monde déclenche le stroboscope plein
// écran au même instant, comme le décompte de départ le fait déjà pour la vidéo.
function scheduleMusicDropTick(room, roomId) {
  const delay = MUSIC_DROP_MIN_MS + Math.random() * (MUSIC_DROP_MAX_MS - MUSIC_DROP_MIN_MS);
  const timer = setTimeout(() => {
    if (rooms.get(roomId) !== room || !room.round.active) return;
    const dropAt = Date.now() + MUSIC_DROP_LEAD_MS;
    io.to(roomId).emit('music-drop', { dropAt, durationMs: MUSIC_DROP_STROBE_MS });
    scheduleMusicDropTick(room, roomId);
  }, delay);
  room.round.timers.push(timer);
}

// Démarre le décompte du mini-jeu, calé sur le "top départ" (anchorAt) déjà
// utilisé pour synchroniser la vidéo : tout le monde voit le même décompte et
// les objets deviennent ramassables pile au moment où la musique démarre.
function startRoundCountdown(room, roomId) {
  resetRoundState(room, roomId); // on repart d'un mini-jeu propre à chaque nouveau morceau
  const anchorAt = room.currentVideo.anchorAt;
  room.round.countdownEndAt = anchorAt;
  io.to(roomId).emit('round-state', { active: false, items: [], discoTiles: [], countdownEndAt: anchorAt, musicPulse: room.musicPulse });
  const delay = Math.max(0, anchorAt - Date.now());
  const timer = setTimeout(() => activateRound(room, roomId), delay);
  room.round.timers.push(timer);
}

function activateRound(room, roomId) {
  if (rooms.get(roomId) !== room) return; // la salle a pu disparaître entre-temps
  room.round.active = true;
  // plancher de pièces pour le malus "perte de pièces" : personne ne peut
  // descendre en dessous de ce qu'il avait déjà avant ce morceau.
  for (const pid of Object.keys(room.players)) {
    const pl = room.players[pid];
    if (pl.token) pl.roundStartCoins = getOrCreateProfile(pl.token).coins;
  }
  for (let i = 0; i < ROUND_INITIAL_ITEMS; i++) spawnItem(room);
  buildDiscoGrid(room);
  scheduleDiscoTileTick(room, roomId);
  // rythme simulé pour la vibration/l'assombrissement de la piste, et
  // programmation du premier "drop" (cf. commentaire sur MUSIC_PULSE_BPM_MIN).
  room.musicPulse = {
    bpm: MUSIC_PULSE_BPM_MIN + Math.random() * (MUSIC_PULSE_BPM_MAX - MUSIC_PULSE_BPM_MIN),
    anchorAt: room.currentVideo.anchorAt
  };
  scheduleMusicDropTick(room, roomId);
  if (room.lightEffects.autoMode && !room.autoLightsRunning) {
    scheduleAutoLightsTick(room, roomId);
  }
  io.to(roomId).emit('round-state', {
    active: true,
    items: Object.values(room.round.items),
    discoTiles: room.round.discoTiles,
    countdownEndAt: null,
    musicPulse: room.musicPulse
  });
}

// Annule les délais en attente, vide la piste et efface les effets de statut
// actifs sur tout le monde, SANS prévenir les clients du nouvel état (utilisé
// juste avant de renvoyer tout de suite un état plus à jour, pour éviter un
// message "round-state" intermédiaire qui arriverait juste avant le bon).
function resetRoundState(room, roomId) {
  clearRoundTimers(room);
  room.round.items = {};
  room.round.discoTiles = [];
  room.round.active = false;
  room.round.countdownEndAt = null;
  room.musicPulse = { bpm: null, anchorAt: null };
  room.autoLightsRunning = false;
  for (const pid of Object.keys(room.players)) {
    const pl = room.players[pid];
    if (pl.effectTimer) { clearTimeout(pl.effectTimer); pl.effectTimer = null; }
    if (pl.statusEffect) {
      pl.statusEffect = null;
      io.to(roomId).emit('player-effect', { id: pid, effect: null });
    }
  }
}

// Arrête le mini-jeu en cours (fin de morceau, passage de main, déconnexion du
// DJ) et prévient tout le monde que la piste est maintenant vide.
function endRound(room, roomId) {
  resetRoundState(room, roomId);
  io.to(roomId).emit('round-state', { active: false, items: [], discoTiles: [], countdownEndAt: null, musicPulse: room.musicPulse });
}

// Un festivalier a marché sur un objet : on le retire de la piste, on applique
// son effet, et on programme sa réapparition ailleurs après un court délai.
function checkItemPickup(room, roomId, playerId, p) {
  const now = Date.now();
  if (p.lastItemPickupAt && now - p.lastItemPickupAt < ITEM_PICKUP_COOLDOWN_MS) return;
  for (const item of Object.values(room.round.items)) {
    const dx = p.x - item.x, dy = p.y - item.y;
    if (Math.hypot(dx, dy) <= ITEM_PICKUP_RADIUS) {
      p.lastItemPickupAt = now;
      delete room.round.items[item.id];
      io.to(roomId).emit('item-collected', { itemId: item.id });
      applyItemEffect(room, roomId, playerId, item.type);
      const delay = ROUND_RESPAWN_MIN_MS + Math.random() * (ROUND_RESPAWN_MAX_MS - ROUND_RESPAWN_MIN_MS);
      const timer = setTimeout(() => {
        if (rooms.get(roomId) !== room || !room.round.active) return;
        spawnItem(room);
        broadcastRoundItems(room, roomId);
      }, delay);
      room.round.timers.push(timer);
      break; // un seul objet ramassé par mouvement, même si deux se chevauchent
    }
  }
}

// Une case disco allumée vient d'être marchée dessus : elle s'éteint, et
// rapporte aléatoirement 1 à 5 pièces à qui l'a ramassée.
function checkDiscoTilePickup(room, roomId, playerId, p) {
  const tiles = room.round.discoTiles;
  if (!tiles || !tiles.length) return;
  for (const tile of tiles) {
    if (!tile.lit) continue;
    const dx = p.x - tile.x, dy = p.y - tile.y;
    if (Math.hypot(dx, dy) <= DISCO_TILE_PICKUP_RADIUS) {
      tile.lit = false;
      broadcastDiscoTiles(room, roomId);
      const player = room.players[playerId];
      if (player && player.token) {
        const gain = 1 + Math.floor(Math.random() * 5); // 1 à 5 pièces
        const profile = getOrCreateProfile(player.token);
        profile.coins += gain;
        scheduleSaveProfiles();
        io.to(playerId).emit('profile-updated', publicProfile(player.token));
        io.to(playerId).emit('item-effect', { type: 'coins', gain });
      }
      break; // une seule case par mouvement
    }
  }
}

// Trouve le festivalier le plus proche (hors DJ et hors le joueur lui-même),
// dans un rayon raisonnable — utilisé par les objets qui visent un adversaire.
function findNearestOpponent(room, pickerId) {
  const picker = room.players[pickerId];
  if (!picker) return null;
  let bestId = null, bestDist = Infinity;
  for (const id of Object.keys(room.players)) {
    if (id === pickerId || id === room.djId) continue;
    const other = room.players[id];
    const dist = Math.hypot(picker.x - other.x, picker.y - other.y);
    if (dist < bestDist) { bestDist = dist; bestId = id; }
  }
  return (bestId && bestDist <= OPPONENT_MAX_RADIUS) ? bestId : null;
}

function applyStatusEffect(room, roomId, playerId, effectType, durationMs) {
  const player = room.players[playerId];
  if (!player) return;
  if (player.effectTimer) clearTimeout(player.effectTimer);
  const expiresAt = Date.now() + durationMs;
  player.statusEffect = { type: effectType, expiresAt };
  io.to(roomId).emit('player-effect', { id: playerId, effect: player.statusEffect });
  player.effectTimer = setTimeout(() => {
    const stillThere = room.players[playerId];
    if (stillThere && stillThere.statusEffect && stillThere.statusEffect.type === effectType) {
      stillThere.statusEffect = null;
      io.to(roomId).emit('player-effect', { id: playerId, effect: null });
    }
  }, durationMs);
}

// Pousse un adversaire à l'écart (matraque) : déplacement instantané, envoyé
// en plus à sa propre connexion pour qu'il resynchronise sa position locale
// (sinon sa prochaine frame de déplacement écraserait le déplacement reçu).
function pushPlayer(room, roomId, attackerId, targetId) {
  const attacker = room.players[attackerId], target = room.players[targetId];
  if (!attacker || !target) return;
  let dx = target.x - attacker.x, dy = target.y - attacker.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  dx /= dist; dy /= dist;
  const PUSH_DIST = 0.16;
  target.x = clamp(target.x + dx * PUSH_DIST, 0.05, 0.95);
  target.y = clamp(target.y + dy * PUSH_DIST, 0.35, 0.9);
  io.to(roomId).emit('player-moved', { id: targetId, x: target.x, y: target.y });
  io.to(targetId).emit('you-were-pushed', { x: target.x, y: target.y });
  io.to(roomId).emit('player-pushed', { id: targetId });
}

// Applique l'effet d'un objet ramassé : gains/pertes instantanés de pièces ou
// d'XP, ou effet de statut (5s max) sur soi-même ou sur l'adversaire le plus
// proche selon l'objet.
function applyItemEffect(room, roomId, playerId, type) {
  const picker = room.players[playerId];
  const def = ITEM_TYPES[type];
  if (!picker || !picker.token || !def) return;
  const profile = getOrCreateProfile(picker.token);

  switch (def.effect) {
    case 'coins': {
      const gain = 4 + Math.floor(Math.random() * 4); // 4 à 7 pièces
      profile.coins += gain;
      scheduleSaveProfiles();
      io.to(playerId).emit('profile-updated', publicProfile(picker.token));
      io.to(playerId).emit('item-effect', { type: 'coins', gain });
      break;
    }
    case 'xp': {
      const gain = 6 + Math.floor(Math.random() * 5); // 6 à 10 XP
      const levelBefore = levelForXp(profile.xp);
      profile.xp += gain;
      const levelAfter = levelForXp(profile.xp);
      scheduleSaveProfiles();
      io.to(playerId).emit('profile-updated', publicProfile(picker.token));
      io.to(playerId).emit('item-effect', { type: 'xp', gain, leveledUp: levelAfter > levelBefore, level: levelAfter });
      break;
    }
    case 'lose_coins': {
      const floor = typeof picker.roundStartCoins === 'number' ? picker.roundStartCoins : 0;
      const loss = Math.max(0, Math.min(6, profile.coins - floor));
      profile.coins -= loss;
      scheduleSaveProfiles();
      io.to(playerId).emit('profile-updated', publicProfile(picker.token));
      io.to(playerId).emit('item-effect', { type: 'lose_coins', loss });
      break;
    }
    case 'speed':
    case 'blurred':
    case 'inverted':
    case 'frozen':
      applyStatusEffect(room, roomId, playerId, def.effect, STATUS_EFFECT_MS);
      break;
    case 'slow_opponent': {
      const target = findNearestOpponent(room, playerId);
      if (target) applyStatusEffect(room, roomId, target, 'slowed', STATUS_EFFECT_MS);
      break;
    }
    case 'push_opponent': {
      const target = findNearestOpponent(room, playerId);
      if (target) pushPlayer(room, roomId, playerId, target);
      break;
    }
  }
}

function advanceDjQueue(room, roomId) {
  if (room.djQueue.length === 0) return false;
  const previousDjId = room.djId;
  const nextDjId = room.djQueue.shift();
  room.djId = nextDjId;

  // l'ancien DJ redevient un festivalier normal, le nouveau prend sa place sur scène
  if (room.players[previousDjId]) {
    room.players[previousDjId].pose = 'idle';
    io.to(roomId).emit('player-posed', { id: previousDjId, pose: 'idle' });
  }
  if (room.players[nextDjId]) {
    room.players[nextDjId].pose = 'dj_behind';
    room.players[nextDjId].bubbleSize = Math.max(room.players[nextDjId].bubbleSize || 1.0, 1.2);
    io.to(roomId).emit('player-posed', { id: nextDjId, pose: 'dj_behind' });
  }

  io.to(roomId).emit('dj-changed', room.djId);
  io.to(roomId).emit('dj-queue-changed', room.djQueue);
  return true;
}

server.listen(PORT, () => {
  console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
