// server/config.js
// Constantes de réglage et petites fonctions pures partagées par tous les
// autres modules serveur (aucune dépendance vers eux, aucun état mutable
// autre que la Map/le Set en lecture seule ci-dessous). Modifier une valeur
// ici (durée, rayon, couleur...) suffit à changer le réglage partout où il
// est utilisé, sans devoir chercher dans plusieurs fichiers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// --- fichiers audio/vidéo importés par un DJ (MP3, MP4, WAV...), en alternative
// au lien YouTube. Stockés temporairement sur le disque (comme data/profiles.json,
// ça ne survit pas à un redéploiement sur un hébergeur au disque éphémère, mais
// c'est très bien pour la durée d'une soirée) et nettoyés dès qu'un morceau est
// remplacé ou que la salle se vide (cf. clearRoomTrackFile).
const TRACKS_DIR = path.join(__dirname, '..', 'data', 'tracks');
try { fs.mkdirSync(TRACKS_DIR, { recursive: true }); } catch (e) { /* déjà là */ }

const MAX_TRACK_SIZE_BYTES = 30 * 1024 * 1024; // 30 Mo : largement assez pour un morceau compressé
const ALLOWED_TRACK_MIMETYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac',
  'video/mp4', 'video/webm'
]);

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
// Moins d'objets en meme temps sur la piste, mais un rythme d'apparition plus
// rapide : chaque objet ne reste que ITEM_LIFETIME_MS avant de disparaitre
// tout seul s'il n'est pas ramasse (cf. spawnItem), puis un autre reapparait
// vite ailleurs (delai de reapparition raccourci).
const ROUND_INITIAL_ITEMS = 4;
const ITEM_LIFETIME_MS = 5000;
const ROUND_RESPAWN_MIN_MS = 1200;
const ROUND_RESPAWN_MAX_MS = 2500;
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

const palette = ['#ff5fa3', '#5ad1ff', '#c98bff', '#7ee08a', '#ff9f5a', '#ffd35a'];
function colorFor(index) {
  return palette[index % palette.length];
}

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex'); // ex: "a1b2c3"
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const allowedAvatarTypes = ['human', 'robot', 'alien', 'ghost', 'dragon', 'blob'];
const allowedAvatarColors = ['#ff5fa3', '#5ad1ff', '#ffd35a'];

// Personnalisation modulaire du festivalier (humain uniquement) : juste des index
// dans des listes fixes côté client (coiffure/visage, couleur du haut, longueur de
// manche, couleur du pantalon, teint de peau) — aucune conséquence sur le jeu,
// donc on se contente de les ramener dans des bornes sûres (0..9).
function sanitizeHumanCustom(input) {
  const clamp = (v) => {
    const n = Number.isInteger(v) ? v : 0;
    return Math.min(19, Math.max(0, n));
  };
  const src = input && typeof input === 'object' ? input : {};
  return {
    hairIndex: clamp(src.hairIndex),
    shirtIndex: clamp(src.shirtIndex),
    sleeveIndex: clamp(src.sleeveIndex),
    pantsIndex: clamp(src.pantsIndex),
    skinIndex: clamp(src.skinIndex)
  };
}

const validLaserStyles = ['rotating', 'fan', 'cross', 'sweep', 'converge', 'chase', 'burst', 'flash'];
function isHexColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

// Formats de laser préférés à l'approche/pendant un drop (rafale/flash en
// plus, pour une vraie salve façon plusieurs lasers qui claquent d'un coup —
// même logique que côté client, cf. DROP_LASER_STYLES) et couleurs par
// séquence (plus froid/posé au calme, plus chaud en montée, franc et
// éclatant sur le drop) — même esprit que SECTION_COLOR_POOLS côté client,
// pour qu'un lien YouTube ait lui aussi une couleur qui suit le morceau.
const DROP_PREFERRED_LASER_STYLES = ['burst', 'flash', 'fan', 'chase'];
const AUTO_LIGHT_COLOR_POOLS = {
  normal: AUTO_LIGHT_COLORS,
  buildup: ['#ffd35a', '#ff8c3d', '#ff5fa3', '#ffb84d'],
  drop: ['#ffffff', '#ff4d6d', '#ff5fa3', '#5ad1ff', '#4ade80'],
};

module.exports = {
  PORT,
  TRACKS_DIR,
  MAX_TRACK_SIZE_BYTES,
  ALLOWED_TRACK_MIMETYPES,
  ITEM_TYPES,
  ITEM_TYPE_KEYS,
  ROUND_INITIAL_ITEMS,
  ITEM_LIFETIME_MS,
  ROUND_RESPAWN_MIN_MS,
  ROUND_RESPAWN_MAX_MS,
  STATUS_EFFECT_MS,
  ITEM_PICKUP_RADIUS,
  OPPONENT_MAX_RADIUS,
  ITEM_PICKUP_COOLDOWN_MS,
  DEFAULT_FLOOR_MIN_Y,
  isValidFloorMinY,
  DISCO_GRID_COLS,
  DISCO_GRID_ROWS,
  DISCO_TILE_INTERVAL_MIN_MS,
  DISCO_TILE_INTERVAL_MAX_MS,
  DISCO_TILE_MAX_LIT,
  DISCO_TILE_PICKUP_RADIUS,
  DISCO_TILE_COLORS,
  MUSIC_PULSE_BPM_MIN,
  MUSIC_PULSE_BPM_MAX,
  MUSIC_DROP_MIN_MS,
  MUSIC_DROP_MAX_MS,
  MUSIC_DROP_LEAD_MS,
  MUSIC_DROP_STROBE_MS,
  AUTO_LIGHTS_MIN_MS,
  AUTO_LIGHTS_MAX_MS,
  AUTO_LIGHT_COLORS,
  MANUAL_EFFECT_LEAD_MS,
  STROBE_INTENSITY_DEFAULT,
  STROBE_INTENSITY_MAX,
  STROBE_DURATION_DEFAULT_MS,
  STROBE_DURATION_MIN_MS,
  STROBE_DURATION_MAX_MS,
  SHAKE_INTENSITY_DEFAULT,
  SHAKE_REPEAT_DEFAULT,
  SHAKE_REPEAT_MIN,
  SHAKE_REPEAT_MAX,
  SHAKE_PERIOD_MS,
  SHOP_ITEMS,
  shopItemsById,
  freeAccessories,
  palette,
  colorFor,
  generateRoomId,
  clamp,
  pick,
  allowedAvatarTypes,
  allowedAvatarColors,
  sanitizeHumanCustom,
  validLaserStyles,
  isHexColor,
  DROP_PREFERRED_LASER_STYLES,
  AUTO_LIGHT_COLOR_POOLS
};
