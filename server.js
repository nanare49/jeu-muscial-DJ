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
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- fichiers audio/vidéo importés par un DJ (MP3, MP4, WAV...), en alternative
// au lien YouTube. Stockés temporairement sur le disque (comme data/profiles.json,
// ça ne survit pas à un redéploiement sur un hébergeur au disque éphémère, mais
// c'est très bien pour la durée d'une soirée) et nettoyés dès qu'un morceau est
// remplacé ou que la salle se vide (cf. clearRoomTrackFile).
const TRACKS_DIR = path.join(__dirname, 'data', 'tracks');
try { fs.mkdirSync(TRACKS_DIR, { recursive: true }); } catch (e) { /* déjà là */ }
app.use('/tracks', express.static(TRACKS_DIR));

const MAX_TRACK_SIZE_BYTES = 30 * 1024 * 1024; // 30 Mo : largement assez pour un morceau compressé
const ALLOWED_TRACK_MIMETYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac',
  'video/mp4', 'video/webm'
]);
const trackUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TRACKS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: MAX_TRACK_SIZE_BYTES },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_TRACK_MIMETYPES.has(file.mimetype))
});

app.post('/upload-track', (req, res) => {
  trackUpload.single('track')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (30 Mo max).' : "Import du fichier impossible.";
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Format non reconnu (fichier audio ou vidéo attendu).' });
    res.json({
      url: '/tracks/' + req.file.filename,
      name: String(req.body && req.body.name || req.file.originalname || 'Morceau importé').slice(0, 100)
    });
  });
});

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
      ownedItems: [],
      unlockedTracks: []
    };
  }
  // normalisation défensive : un profil sauvegardé avant l'ajout du système de
  // musiques à débloquer n'a pas ce champ tant qu'on ne le lui a pas ajouté ici
  if (!Array.isArray(profiles[token].unlockedTracks)) profiles[token].unlockedTracks = [];
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
    ownedItems: p.ownedItems,
    unlockedTracks: p.unlockedTracks
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

// --- ambiance musicale simulée : quand le morceau vient d'une vidéo YouTube
// intégrée, son signal audio réel n'est pas accessible (restriction cross-origin
// de l'iframe) — impossible d'analyser le rythme pour de vrai. On simule donc un
// tempo (BPM) et des "drops" à intervalles aléatoires, calés sur le même "top
// départ" (anchorAt) que la vidéo pour que tout le monde les vive exactement au
// même moment. Ce BPM simulé ne sert QUE pour le "drop" surprise programmé
// ci-dessous : quand le morceau est un fichier importé (MP3/MP4/...) plutôt
// qu'un lien YouTube, le rythme de la piste (vibration/assombrissement) n'utilise
// plus cette simulation — chaque navigateur analyse alors le vrai son via l'API
// Web Audio (cf. `ensureAudioGraph`/`updateRealMusicEnergy` côté client). ---
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

// --- Flash Drop (stroboscope) et Tremblement déclenchés à la demande : si le
// DJ garde la main sur les effets (mode auto désactivé), ni l'un ni l'autre
// ne se déclenche tout seul — c'est lui qui choisit couleur/intensité/durée
// (stroboscope) ou intensité/nombre de répétitions (tremblement) puis appuie
// sur un bouton. Un court délai (comme pour un drop automatique) sert juste
// à synchroniser tout le monde sur l'instant exact du déclenchement.
const MANUAL_EFFECT_LEAD_MS = 350;
// Intensité volontairement plafonnée assez bas (cf. STROBE_INTENSITY_MAX) :
// un stroboscope plein écran très lumineux et rapide est un vrai risque pour
// les personnes photosensibles/épileptiques, pas seulement un effet "fort".
const STROBE_INTENSITY_DEFAULT = 0.35;
const STROBE_INTENSITY_MAX = 0.45;
const STROBE_DURATION_DEFAULT_MS = 1400;
const STROBE_DURATION_MIN_MS = 200;
const STROBE_DURATION_MAX_MS = 5000;
const SHAKE_INTENSITY_DEFAULT = 0.6;
const SHAKE_REPEAT_DEFAULT = 3;
const SHAKE_REPEAT_MIN = 1;
const SHAKE_REPEAT_MAX = 10;
const SHAKE_PERIOD_MS = 450; // durée d'une répétition de tremblement

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

// --- Bibliothèque de musiques libres de droits (mode "file obligatoire") ---
// Quand un DJ prend son tour, il choisit parmi ces morceaux plutôt que de coller
// un lien ou d'importer un fichier. Les 3 premiers de chaque thème sont gratuits
// dès le départ ; les suivants se débloquent avec les pièces gagnées en jouant
// (cf. `unlock-track`). Les fichiers doivent être déposés dans
// public/tracks/library/<genre>/<file> — servis automatiquement via le
// middleware express.static déjà en place sur le dossier public.
const GENRE_LABELS = { electro: 'Électro', rock: 'Rock', pop: 'Pop', rap: 'Rap / Hip-Hop' };
const MUSIC_LIBRARY = {
  electro: [
    { id: 'electro-1', title: 'Energetic Party', artist: 'alex-morgan', file: 'electro-1-energetic-party.mp3', cost: 0 },
    { id: 'electro-2', title: 'Trance Euphoria', artist: 'alex-morgan', file: 'electro-2-trance-euphoria.mp3', cost: 0 },
    { id: 'electro-3', title: 'Melodic Techno Journey', artist: 'alex-morgan', file: 'electro-3-melodic-techno-journey.mp3', cost: 0 },
    { id: 'electro-4', title: 'Techno Warehouse', artist: 'alex-morgan', file: 'electro-4-techno-warehouse.mp3', cost: 60 },
    { id: 'electro-5', title: 'Future Bass', artist: 'alex-morgan', file: 'electro-5-future-bass.mp3', cost: 90 },
    { id: 'electro-6', title: 'Tokyo Night Walk', artist: 'alex-morgan', file: 'electro-6-tokyo-night-walk.mp3', cost: 120 },
    { id: 'electro-7', title: 'Melody so Melody', artist: 'alex-morgan', file: 'electro-7-melody-so-melody.mp3', cost: 150 }
  ],
  rock: [
    { id: 'rock-1', title: 'Hype Attitude', artist: 'alex-morgan', file: 'rock-1-hype-attitude.mp3', cost: 0 },
    { id: 'rock-2', title: 'Sport Rock', artist: 'AtlasAudio', file: 'rock-2-sport-rock.mp3', cost: 0 },
    { id: 'rock-3', title: 'Energetic Rock', artist: 'AtlasAudio', file: 'rock-3-energetic-rock.mp3', cost: 0 },
    { id: 'rock-4', title: 'Stylish Rock', artist: 'AtlasAudio', file: 'rock-4-stylish-rock.mp3', cost: 60 },
    { id: 'rock-5', title: 'Rock Music', artist: 'The_Mountain', file: 'rock-5-rock-music.mp3', cost: 90 },
    { id: 'rock-6', title: 'Punk Rock', artist: 'JonasBlakewood', file: 'rock-6-punk-rock.mp3', cost: 120 },
    { id: 'rock-7', title: 'Upbeat', artist: 'Verclub_Music', file: 'rock-7-upbeat.mp3', cost: 150 }
  ],
  pop: [
    { id: 'pop-1', title: 'Pop Music', artist: 'The_Mountain', file: 'pop-1-pop-music.mp3', cost: 0 },
    { id: 'pop-2', title: 'Upbeat Pop', artist: 'The_Mountain', file: 'pop-2-upbeat-pop.mp3', cost: 0 },
    { id: 'pop-3', title: 'Dance Pop Party', artist: 'JonasBlakewood', file: 'pop-3-dance-pop-party.mp3', cost: 0 },
    { id: 'pop-4', title: 'Dance Music', artist: 'The_Mountain', file: 'pop-4-dance-music.mp3', cost: 60 },
    { id: 'pop-5', title: 'Reel Reels Music', artist: 'Verclub_Music', file: 'pop-5-reel-reels-music.mp3', cost: 90 },
    { id: 'pop-6', title: 'Pop Retro', artist: 'JonasBlakewood', file: 'pop-6-pop-retro.mp3', cost: 120 }
  ],
  rap: [
    { id: 'rap-1', title: 'Hype | Drill Music', artist: 'kontraa', file: 'rap-1-hype-drill.mp3', cost: 0 },
    { id: 'rap-2', title: 'Sad Soul Hip Hop', artist: 'AlexGrohl', file: 'rap-2-sad-soul-hip-hop.mp3', cost: 0 },
    { id: 'rap-3', title: 'Hip-Hop', artist: 'The_Mountain', file: 'rap-3-hip-hop.mp3', cost: 0 },
    { id: 'rap-4', title: 'Hip Hop Street', artist: 'The_Mountain', file: 'rap-4-hip-hop-street.mp3', cost: 60 },
    { id: 'rap-5', title: 'Rap Instrumental', artist: 'The_Mountain', file: 'rap-5-rap-instrumental.mp3', cost: 90 },
    { id: 'rap-6', title: 'Rap Street Cypher Bounce', artist: 'alex-morgan', file: 'rap-6-rap-street-cypher.mp3', cost: 120 },
    { id: 'rap-7', title: 'Free Trap Beat', artist: '5XBeatz', file: 'rap-7-free-trap-beat.mp3', cost: 150 },
    { id: 'rap-8', title: 'French Drill / Jersey', artist: 'YoshYBeats_', file: 'rap-8-french-drill-jersey.mp3', cost: 180 }
  ]
};
const ALL_TRACKS_BY_ID = new Map();
for (const genre of Object.keys(MUSIC_LIBRARY)) {
  for (const track of MUSIC_LIBRARY[genre]) ALL_TRACKS_BY_ID.set(track.id, Object.assign({ genre }, track));
}
const MUSIC_LIBRARY_DIR = path.join(__dirname, 'public', 'tracks', 'library');
// Durée (ms) laissée au DJ dont c'est le tour pour choisir un morceau avant
// qu'un morceau débloqué au hasard soit lancé à sa place.
const TRACK_CHOICE_MS = 15000;

function isTrackUnlockedForToken(track, token) {
  if (track.cost <= 0) return true;
  const profile = getOrCreateProfile(token);
  return profile.unlockedTracks.includes(track.id);
}

// Choisit un morceau au hasard parmi ceux déjà débloqués par ce DJ (ou parmi
// tous si, par accident, aucun n'était débloqué) — utilisé quand le délai de
// choix (TRACK_CHOICE_MS) s'écoule sans sélection.
function pickRandomUnlockedTrack(token) {
  const all = [...ALL_TRACKS_BY_ID.values()];
  const unlocked = all.filter(t => isTrackUnlockedForToken(t, token));
  const pool = unlocked.length ? unlocked : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildGenrePayloadForToken(genre, token) {
  return {
    id: genre,
    label: GENRE_LABELS[genre],
    tracks: MUSIC_LIBRARY[genre].map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      cost: t.cost,
      unlocked: isTrackUnlockedForToken(t, token)
    }))
  };
}

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
      // Chemin disque du fichier importé actuellement chargé (cf. clearRoomTrackFile) ;
      // null quand c'est un lien YouTube ou qu'aucun morceau n'est encore chargé.
      uploadedTrackFilePath: null,
      creatorId: null,
      // 'rotation' (par défaut) : tout le monde passe DJ à tour de rôle, obligatoire,
      // et choisit son morceau dans la bibliothèque libre de droits à chaque tour.
      // 'fixed' : le créateur reste DJ en continu et choisit sa musique lui-même
      // (lien YouTube ou fichier importé), comme avant — utile pour un DJ live.
      djMode: 'rotation',
      djQueue: [],      // en mode 'rotation' : ordre des prochains DJ (le DJ actuel n'y est pas)
      // Choix de morceau en cours pour le DJ actuel (mode 'rotation' uniquement) :
      // { deadlineAt, timer } tant que le délai de TRACK_CHOICE_MS court, sinon null.
      trackChoice: null,
      // Passage DJ en cours : remis à zéro à chaque nouveau passage (cf. settleDjTurn).
      // `trackStarted` : vrai dès que ce DJ a lancé un morceau pendant son passage —
      // sert (en mode fixe, ou en file d'attente) à l'empêcher d'en relancer un
      // autre avant de céder la main (cf. djCanStartNewTrack).
      currentDjTurn: { settled: false, trackStarted: false },
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
      musicDropRunning: false, // idem pour la boucle des drops automatiques
      lightEffects: {
        flash: { on: false, color: '#ff5fa3' },
        laser: { on: false, color: '#5ad1ff', count: 4, style: 'rotating' },
        fireballs: { on: false, color: '#ff7a3d', count: 2 },
        sparks: { on: false, color: '#ffd35a', count: 4, intensity: 0.6 },
        discoball: { on: false, color: '#ffffff' },
        smoke: { on: false, color: '#cfd6e6', count: 4 },
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

// Supprime du disque le fichier importé actuellement chargé par cette salle
// (s'il y en a un), quand il est remplacé par un autre morceau ou que la salle
// se vide — évite d'accumuler des fichiers orphelins sur la durée.
function clearRoomTrackFile(room) {
  if (room.uploadedTrackFilePath) {
    fs.unlink(room.uploadedTrackFilePath, () => {});
    room.uploadedTrackFilePath = null;
  }
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && Object.keys(room.players).length === 0) {
    clearRoomTrackFile(room);
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
      room.creatorId = socket.id; // lui seul pourra choisir le mode DJ unique / rotation
    } else if (room.djMode === 'rotation' && socket.id !== room.djId && !room.djQueue.includes(socket.id)) {
      // en mode rotation, chaque nouvel arrivant rejoint automatiquement la file
      // (obligatoire, pas d'inscription volontaire) pour avoir son tour plus tard
      room.djQueue.push(socket.id);
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
      canStartNewTrack: djCanStartNewTrack(room),
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
      shopCatalog: SHOP_ITEMS,
      musicGenres: Object.keys(MUSIC_LIBRARY).map(g => buildGenrePayloadForToken(g, token)),
      trackChoice: room.trackChoice ? { djId: room.djId, djName: (room.players[room.djId] || {}).name, deadlineAt: room.trackChoice.deadlineAt } : null
    });

    socket.to(currentRoomId).emit('player-joined', { id: socket.id, player: sanitizePlayerForClients(player) });
    if (room.djMode === 'rotation' && !room.trackChoice && !room.currentVideo) {
      // toute première connexion dans une salle neuve en mode rotation : on ouvre
      // tout de suite la fenêtre de choix du DJ (le créateur, premier arrivant)
      beginDjTurn(room, currentRoomId);
    } else if (!isFirstInRoom && room.djMode === 'rotation') {
      io.to(currentRoomId).emit('dj-queue-changed', room.djQueue);
    }
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

  // Le créateur de la salle choisit : 'rotation' (tout le monde passe DJ à tour
  // de rôle, par défaut) ou 'fixed' (le créateur reste DJ en continu, façon DJ live).
  socket.on('set-dj-mode', (mode) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.creatorId) return;
    const wasRotation = room.djMode === 'rotation';
    room.djMode = mode === 'fixed' ? 'fixed' : 'rotation';
    if (room.djMode === 'fixed') {
      room.djQueue = [];
      if (room.trackChoice) { clearTimeout(room.trackChoice.timer); room.trackChoice = null; }
    } else if (!wasRotation) {
      // on vient d'activer la rotation : tout le monde sauf le DJ actuel rejoint la file
      room.djQueue = Object.keys(room.players).filter(id => id !== room.djId);
      if (!room.currentVideo) beginDjTurn(room, currentRoomId); // sinon on attend la fin du morceau en cours
    }
    io.to(currentRoomId).emit('dj-mode-changed', { mode: room.djMode, queue: room.djQueue });
    emitDjTurnState(room, currentRoomId);
  });

  // Le DJ dont c'est le tour choisit son morceau dans la fenêtre de
  // TRACK_CHOICE_MS ouverte par beginDjTurn (cf. évènement 'track-choices').
  socket.on('choose-track', (trackId) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.djMode !== 'rotation' || socket.id !== room.djId) return;
    if (!room.trackChoice) return; // fenêtre déjà refermée (tirage au sort entre-temps)
    const track = ALL_TRACKS_BY_ID.get(String(trackId));
    if (!track) return;
    const djPlayer = room.players[socket.id];
    if (!isTrackUnlockedForToken(track, djPlayer.token)) return; // pas encore débloqué
    startLibraryTrack(room, currentRoomId, track);
  });

  // Débloque un morceau payant avec les pièces gagnées en jouant (comme la boutique).
  socket.on('unlock-track', (trackId) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const p = room && room.players[socket.id];
    if (!p) return;
    const track = ALL_TRACKS_BY_ID.get(String(trackId));
    if (!track || track.cost <= 0) return;
    const profile = getOrCreateProfile(p.token);
    if (profile.unlockedTracks.includes(track.id)) return; // déjà débloqué
    if (profile.coins < track.cost) return; // pas assez de pièces
    profile.coins -= track.cost;
    profile.unlockedTracks.push(track.id);
    scheduleSaveProfiles();
    socket.emit('profile-updated', publicProfile(p.token));
    // si ce joueur est justement en train de choisir sa musique, on lui renvoie
    // la liste à jour pour que le morceau tout juste débloqué apparaisse déblocable
    if (room.trackChoice && room.djId === socket.id) {
      socket.emit('track-choices', {
        deadlineAt: room.trackChoice.deadlineAt,
        genres: Object.keys(MUSIC_LIBRARY).map(g => buildGenrePayloadForToken(g, p.token))
      });
    }
  });

  // Le DJ actuel décide de passer la main tout de suite (bouton "Passer la main") :
  // on solde d'abord son passage (notes -> XP/pièces), puis on avance la file et
  // on ouvre aussitôt la fenêtre de choix du morceau pour le suivant.
  socket.on('next-dj', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.djMode !== 'rotation' || socket.id !== room.djId) return;
    settleDjTurn(room, currentRoomId);
    advanceDjQueue(room, currentRoomId);
    beginDjTurn(room, currentRoomId);
  });

  // Une vidéo vient de se terminer chez le DJ actuel : on solde son passage dans
  // tous les cas (même en mode DJ unique, où il reste DJ mais touche quand même
  // la récompense de ce morceau), et on avance la file + relance un choix de
  // morceau pour le suivant seulement en mode 'rotation'.
  socket.on('video-ended', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    settleDjTurn(room, currentRoomId);
    if (room.djMode === 'rotation') {
      advanceDjQueue(room, currentRoomId);
      beginDjTurn(room, currentRoomId);
    }
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
    if (room.djMode !== 'fixed') return; // en mode 'rotation', la musique vient du choix (cf. choose-track)
    if (!djCanStartNewTrack(room)) return; // doit d'abord céder la main (file d'attente non vide)
    clearRoomTrackFile(room); // on quitte un éventuel fichier importé précédent
    room.currentVideo = {
      source: 'youtube',
      videoId,
      title: String(title || '').slice(0, 100),
      paused: false,
      positionSec: 0,
      anchorAt: Date.now() + 6000 // 6 secondes de marge avant le vrai départ
    };
    room.currentDjTurn.trackStarted = true;
    io.to(currentRoomId).emit('video-state', room.currentVideo);
    // le mini-jeu de ramassage démarre en même temps que la musique : le décompte
    // affiché à tout le monde vise ce même "top départ" (anchorAt).
    startRoundCountdown(room, currentRoomId);
    emitDjTurnState(room, currentRoomId);
  });

  // Le DJ a importé un fichier audio/vidéo local (MP3, MP4, WAV...) plutôt que
  // collé un lien YouTube : même mécanique de "top départ" commun, mais cette
  // fois via un vrai élément <audio>, ce qui permet à chaque navigateur d'analyser
  // le vrai son (cf. `ensureAudioGraph` côté client) au lieu du rythme simulé.
  socket.on('play-file-track', ({ url, name }) => {
    if (!currentRoomId || !url) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    if (room.djMode !== 'fixed') return; // en mode 'rotation', la musique vient du choix (cf. choose-track)
    if (!djCanStartNewTrack(room)) return; // doit d'abord céder la main (file d'attente non vide)
    const urlStr = String(url);
    // seuls les fichiers qu'on vient nous-mêmes de stocker via /upload-track
    // sont acceptés (empêche de faire pointer tout le monde vers une URL arbitraire)
    if (!urlStr.startsWith('/tracks/')) return;
    const filePath = path.join(TRACKS_DIR, path.basename(urlStr));
    if (!fs.existsSync(filePath)) return; // a dû expirer/être nettoyé entre-temps
    clearRoomTrackFile(room);
    room.uploadedTrackFilePath = filePath;
    room.currentVideo = {
      source: 'file',
      url: urlStr,
      title: String(name || 'Morceau importé').slice(0, 100),
      paused: false,
      positionSec: 0,
      anchorAt: Date.now() + 6000
    };
    room.currentDjTurn.trackStarted = true;
    io.to(currentRoomId).emit('video-state', room.currentVideo);
    startRoundCountdown(room, currentRoomId);
    emitDjTurnState(room, currentRoomId);
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
    if (!wasAuto && requestedAuto) startAutoAmbiance(room, currentRoomId);
  });

  // Flash Drop (stroboscope) déclenché à la demande par le DJ, uniquement
  // quand il garde la main (en mode auto, c'est la régie qui décide seule).
  // Le DJ choisit couleur, intensité et durée ; un très court délai sert
  // juste à synchroniser le déclenchement chez tout le monde.
  socket.on('trigger-strobe', (payload) => {
    if (!currentRoomId || !payload) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    if (room.lightEffects.autoMode) return; // la régie auto décide seule dans ce mode
    const color = isHexColor(payload.color) ? payload.color : '#ffffff';
    const intensityRaw = Number(payload.intensity);
    const intensity = Number.isFinite(intensityRaw) ? clamp(intensityRaw, 0.1, STROBE_INTENSITY_MAX) : STROBE_INTENSITY_DEFAULT;
    const durationRaw = Math.round(Number(payload.durationMs));
    const durationMs = Number.isFinite(durationRaw) ? clamp(durationRaw, STROBE_DURATION_MIN_MS, STROBE_DURATION_MAX_MS) : STROBE_DURATION_DEFAULT_MS;
    const dropAt = Date.now() + MANUAL_EFFECT_LEAD_MS;
    io.to(currentRoomId).emit('music-drop', { dropAt, durationMs, color, intensity });
  });

  // Tremblement déclenché à la demande, même principe : le DJ choisit
  // l'intensité et le nombre de répétitions, rien ne se déclenche tout seul
  // tant qu'il garde la main.
  socket.on('trigger-shake', (payload) => {
    if (!currentRoomId || !payload) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.djId) return;
    if (room.lightEffects.autoMode) return;
    const intensityRaw = Number(payload.intensity);
    const intensity = Number.isFinite(intensityRaw) ? clamp(intensityRaw, 0.1, 1) : SHAKE_INTENSITY_DEFAULT;
    const repeatRaw = Math.round(Number(payload.repeatCount));
    const repeatCount = Number.isFinite(repeatRaw) ? clamp(repeatRaw, SHAKE_REPEAT_MIN, SHAKE_REPEAT_MAX) : SHAKE_REPEAT_DEFAULT;
    const startAt = Date.now() + MANUAL_EFFECT_LEAD_MS;
    io.to(currentRoomId).emit('music-shake', { startAt, intensity, repeatCount, periodMs: SHAKE_PERIOD_MS });
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
        // si le DJ partait en pleine sélection de musique, on annule le minuteur
        // en cours pour éviter qu'il ne se déclenche sur un DJ qui n'existe plus
        if (room.trackChoice) {
          clearTimeout(room.trackChoice.timer);
          room.trackChoice = null;
        }
        const advanced = room.djMode === 'rotation' && advanceDjQueue(room, currentRoomId);
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
        // en mode rotation, le nouveau DJ (s'il y en a un) doit choisir sa musique
        if (room.djMode === 'rotation' && room.djId) {
          beginDjTurn(room, currentRoomId);
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

const validLaserStyles = ['rotating', 'fan', 'cross', 'sweep', 'converge', 'chase'];
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
  const smokeIn = payload.smoke || {};
  const validSmokeCounts = [1, 2, 3, 4, 5, 6, 7];
  const smokeCountRaw = Math.round(Number(smokeIn.count));
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
    smoke: {
      on: !!smokeIn.on,
      color: isHexColor(smokeIn.color) ? smokeIn.color : (previous.smoke ? previous.smoke.color : '#cfd6e6'),
      count: validSmokeCounts.includes(smokeCountRaw) ? smokeCountRaw : (previous.smoke ? previous.smoke.count : 4)
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
      smoke: { on: Math.random() < 0.35, color: pick(AUTO_LIGHT_COLORS), count: 2 + Math.floor(Math.random() * 5) },
      power: 0.4 + Math.random() * 0.6,
      speed: 0.6 + Math.random() * 1.4,
      autoMode: true
    };
    io.to(roomId).emit('light-effects-changed', room.lightEffects);
    scheduleAutoLightsTick(room, roomId);
  }, delay);
  room.round.timers.push(timer);
}

// Démarre les deux boucles d'ambiance automatique (effets lumineux + drops)
// si le mode auto est actif et qu'un morceau tourne — appelé au début d'un
// round, et quand le DJ active le mode auto en cours de route. Sans effet si
// déjà en cours (évite de lancer deux boucles en parallèle).
function startAutoAmbiance(room, roomId) {
  if (!room.round.active || !room.lightEffects.autoMode) return;
  if (!room.autoLightsRunning) scheduleAutoLightsTick(room, roomId);
  if (!room.musicDropRunning) scheduleMusicDropTick(room, roomId);
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
  room.currentDjTurn = { settled: false, trackStarted: false };
  emitDjTurnState(room, roomId);
}

// Vrai si le DJ actuel a le droit de lancer un (nouveau) morceau : toujours
// vrai en mode DJ unique ou si la file d'attente est vide, mais faux en mode
// file d'attente dès que ce DJ a déjà lancé un morceau pendant son passage et
// qu'au moins une personne attend son tour — il doit d'abord céder la main
// (cf. "next-dj" ou la fin naturelle du morceau) plutôt que d'en relancer un
// autre indéfiniment.
function djCanStartNewTrack(room) {
  // En mode 'rotation', le morceau vient du choix (cf. beginDjTurn/choose-track),
  // jamais d'un lancement manuel répété ; seul le mode 'fixed' utilise encore
  // cette fonction, et n'a jamais eu cette restriction.
  return true;
}
function emitDjTurnState(room, roomId) {
  io.to(roomId).emit('dj-turn-state', { canStartNewTrack: djCanStartNewTrack(room) });
}

// Lance le morceau choisi (ou tiré au sort) par le DJ actuel, en mode 'rotation' :
// prépare l'état vidéo comme pour un fichier importé, avec un "top départ"
// commun (anchorAt) pour que tout le monde parte synchronisé.
function startLibraryTrack(room, roomId, track) {
  if (room.trackChoice) {
    clearTimeout(room.trackChoice.timer);
    room.trackChoice = null;
  }
  clearRoomTrackFile(room); // au cas où un fichier importé (mode fixed précédent) traînait encore
  room.currentVideo = {
    source: 'file',
    url: '/tracks/library/' + track.genre + '/' + track.file,
    title: track.title + ' — ' + track.artist,
    paused: false,
    positionSec: 0,
    anchorAt: Date.now() + 6000
  };
  room.currentDjTurn.trackStarted = true;
  io.to(roomId).emit('video-state', room.currentVideo);
  startRoundCountdown(room, roomId);
  emitDjTurnState(room, roomId);
}

// Démarre le tour du DJ actuel en mode 'rotation' : ouvre la fenêtre de choix
// de TRACK_CHOICE_MS millisecondes (panneau central côté client), et programme
// un tirage au sort si personne n'a choisi à temps.
function beginDjTurn(room, roomId) {
  if (room.djMode !== 'rotation' || !room.djId) return;
  const djPlayer = room.players[room.djId];
  if (!djPlayer) return;
  const deadlineAt = Date.now() + TRACK_CHOICE_MS;
  const timer = setTimeout(() => {
    if (rooms.get(roomId) !== room) return;
    if (!room.trackChoice || room.trackChoice.deadlineAt !== deadlineAt) return; // déjà résolu entre-temps
    const track = pickRandomUnlockedTrack(djPlayer.token);
    startLibraryTrack(room, roomId, track);
  }, TRACK_CHOICE_MS);
  room.trackChoice = { deadlineAt, timer };
  io.to(roomId).emit('choose-track-prompt', { djId: room.djId, djName: djPlayer.name, deadlineAt });
  io.to(room.djId).emit('track-choices', {
    deadlineAt,
    genres: Object.keys(MUSIC_LIBRARY).map(g => buildGenrePayloadForToken(g, djPlayer.token))
  });
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
// écran au même instant, comme le décompte de départ le fait déjà pour la
// vidéo. Uniquement tant que le mode auto est actif : si le DJ reprend la
// main, la chaîne s'arrête toute seule (il déclenche alors le stroboscope
// lui-même via 'trigger-strobe').
function scheduleMusicDropTick(room, roomId) {
  room.musicDropRunning = true;
  const delay = MUSIC_DROP_MIN_MS + Math.random() * (MUSIC_DROP_MAX_MS - MUSIC_DROP_MIN_MS);
  const timer = setTimeout(() => {
    if (rooms.get(roomId) !== room || !room.round.active || !room.lightEffects.autoMode) {
      room.musicDropRunning = false;
      return;
    }
    const dropAt = Date.now() + MUSIC_DROP_LEAD_MS;
    io.to(roomId).emit('music-drop', { dropAt, durationMs: MUSIC_DROP_STROBE_MS, color: '#ffffff', intensity: STROBE_INTENSITY_MAX });
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
  startAutoAmbiance(room, roomId); // lance effets auto + drops auto, seulement si le mode auto est actif
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
  room.musicDropRunning = false;
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

  // Rotation obligatoire : l'ancien DJ repart en fin de file pour reprendre son
  // tour plus tard, au lieu de sortir définitivement de la file comme avant.
  if (room.djMode === 'rotation' && previousDjId && room.players[previousDjId] && previousDjId !== nextDjId) {
    room.djQueue.push(previousDjId);
  }

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

// Petit diagnostic au démarrage : signale les morceaux de la bibliothèque dont
// le fichier MP3 n'a pas encore été déposé dans public/tracks/library/<genre>/,
// pour repérer facilement ce qu'il reste à ajouter (cf. commentaire plus haut).
function logMissingLibraryTracks() {
  const missing = [];
  for (const track of ALL_TRACKS_BY_ID.values()) {
    const filePath = path.join(MUSIC_LIBRARY_DIR, track.genre, track.file);
    if (!fs.existsSync(filePath)) missing.push(track.genre + '/' + track.file);
  }
  if (missing.length > 0) {
    console.log(`⚠️  ${missing.length} morceau(x) de la bibliothèque manquant(s) dans public/tracks/library/ :`);
    missing.forEach(m => console.log('   - ' + m));
  } else {
    console.log('🎵 Bibliothèque de musiques : tous les fichiers sont présents.');
  }
}

server.listen(PORT, () => {
  logMissingLibraryTracks();
  console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
