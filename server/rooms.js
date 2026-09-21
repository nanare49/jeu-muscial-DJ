// server/rooms.js
// Toutes les salles actives, indexées par leur code (roomId -> état complet
// de la salle : décor, joueurs, vidéo en cours, file DJ, mini-jeu, effets
// lumineux...), plus les petites fonctions qui créent/nettoient une salle et
// qui préparent un joueur à être envoyé aux autres clients (sans son token).
const fs = require('fs');

module.exports = function createRooms({ config }) {
  // Toutes les salles actives, indexées par leur code.
  // roomId -> { decor, players: { socketId -> {...} }, currentVideo }
  const rooms = new Map();

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
        // File d'attente OBLIGATOIRE : tout festivalier qui n'est pas le DJ actuel
        // y est automatiquement (cf. 'join' et advanceDjQueue) — personne ne
        // choisit d'y entrer ou d'en sortir, chacun joue son tour à la suite.
        djQueue: [],
        // Passage DJ en cours : remis à zéro à chaque nouveau passage (cf. settleDjTurn).
        // `trackStarted` : vrai dès que ce DJ a lancé un morceau pendant son passage —
        // sert (en mode file d'attente, avec du monde en attente) à l'empêcher d'en
        // relancer un autre avant de céder la main (cf. djCanStartNewTrack).
        currentDjTurn: { settled: false, trackStarted: false },
        // Case la plus basse (fraction 0..1) où placer un objet/une case disco,
        // affinée au fil des connexions par le "minY" que chaque navigateur
        // signale (cf. isValidFloorMinY) — jamais rien sur la barrière.
        floorMinY: config.DEFAULT_FLOOR_MIN_Y,
        // Mini-jeu de ramassage d'objets sur la piste, actif pendant qu'un morceau tourne.
        round: {
          items: {},          // id -> { id, type, x, y } — jamais d'autre champ ici : ces objets sont
                               // envoyés tels quels aux clients (JSON), donc pas de setTimeout dedans
                               // (ça faisait planter le serveur, cf. itemTimers ci-dessous).
          itemTimers: {},      // id -> setTimeout d'auto-disparition (ITEM_LIFETIME_MS), à part des items
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
        // Horodatage du prochain "drop" programmé (0 = aucun en vue) : sert à faire
        // monter en intensité/vitesse les effets auto AVANT le drop (build-up) et
        // pendant lui, façon vraie régie qui suit les séquences du morceau plutôt
        // que de tirer une intensité au hasard sans lien avec ce qui joue
        // (cf. scheduleAutoLightsTick, scheduleMusicDropTick).
        nextDropAt: 0,
        lightEffects: {
          flash: { on: false, color: '#ff5fa3' },
          laser: { on: false, color: '#5ad1ff', count: 4, style: 'rotating' },
          fireballs: { on: false, color: '#ff7a3d', count: 2 },
          sparks: { on: false, color: '#ffd35a', count: 4, intensity: 0.6 },
          ledbar: { on: false, color: '#ff5fa3' },
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

  return {
    rooms,
    getOrCreateRoom,
    clearRoomTrackFile,
    cleanupRoomIfEmpty,
    sanitizePlayerForClients,
    sanitizePlayersForClients
  };
};
