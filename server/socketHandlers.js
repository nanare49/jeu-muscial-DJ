// server/socketHandlers.js
// Tous les évènements socket.io reçus d'un client (rejoindre une salle,
// bouger, changer de pose, jouer une vidéo, régler les effets lumineux...).
// C'est le seul fichier qui connaît le détail du protocole temps réel ; il
// s'appuie sur les autres modules (rooms, profiles, minigame, djQueue,
// lightEffects, ambiance) pour la logique elle-même.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function registerSocketHandlers({ io, rooms: roomsModule, config, profiles, minigame, djQueue, lightEffects, ambiance }) {
  const { rooms, getOrCreateRoom, sanitizePlayerForClients, sanitizePlayersForClients, clearRoomTrackFile, cleanupRoomIfEmpty } = roomsModule;
  const {
    allowedAvatarTypes, allowedAvatarColors, sanitizeHumanCustom, colorFor, generateRoomId,
    clamp, isHexColor, SHOP_ITEMS, shopItemsById, TRACKS_DIR,
    MANUAL_EFFECT_LEAD_MS, STROBE_INTENSITY_DEFAULT, STROBE_INTENSITY_MAX,
    STROBE_DURATION_DEFAULT_MS, STROBE_DURATION_MIN_MS, STROBE_DURATION_MAX_MS,
    SHAKE_INTENSITY_DEFAULT, SHAKE_REPEAT_DEFAULT, SHAKE_REPEAT_MIN, SHAKE_REPEAT_MAX, SHAKE_PERIOD_MS
  } = config;
  const { isValidToken, getOrCreateProfile, publicProfile, canUseAccessory, scheduleSaveProfiles } = profiles;
  const { checkItemPickup, checkDiscoTilePickup, startRoundCountdown } = minigame;
  const { settleDjTurn, advanceDjQueue, djCanStartNewTrack, emitDjTurnState } = djQueue;
  const { sanitizeLightEffects } = lightEffects;
  const { startAutoAmbiance } = ambiance;

  io.on('connection', (socket) => {
    let currentRoomId = null;

    socket.on('join-room', (payload) => {
      if (currentRoomId) return;

      // accepte l'ancien format (juste une chaîne = code de salle) et le nouveau
      // format objet avec le choix d'avatar fait sur l'écran de sélection
      const requestedRoomId = typeof payload === 'string' ? payload : (payload && payload.roomId);
      const requestedAvatarType = payload && typeof payload === 'object' ? payload.avatarType : null;
      const requestedAvatarColor = payload && typeof payload === 'object' ? payload.avatarColor : null;
      const requestedHumanCustom = payload && typeof payload === 'object' ? payload.humanCustom : null;
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
      if (config.isValidFloorMinY(requestedMinY)) {
        room.floorMinY = Math.max(room.floorMinY, requestedMinY);
      }

      const isFirstInRoom = Object.keys(room.players).length === 0;
      if (isFirstInRoom) {
        room.djId = socket.id; // le premier arrivant devient le DJ de la salle
        room.creatorId = socket.id;
      } else if (!room.djQueue.includes(socket.id)) {
        // Tour obligatoire : quiconque arrive et n'est pas déjà le DJ rejoint
        // automatiquement la file, sans rien avoir à faire.
        room.djQueue.push(socket.id);
      }

      const playerIndex = Object.keys(room.players).length;
      const player = {
        name: requestedName || ('Joueur ' + (playerIndex + 1)),
        x: 0.5,
        y: 0.6,
        pose: 'idle',
        accessory: 'none',
        color: colorFor(playerIndex),
        avatarType: allowedAvatarTypes.includes(requestedAvatarType) ? requestedAvatarType : 'human',
        avatarColor: allowedAvatarColors.includes(requestedAvatarColor) ? requestedAvatarColor : allowedAvatarColors[0],
        humanCustom: sanitizeHumanCustom(requestedHumanCustom),
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
        shopCatalog: SHOP_ITEMS
      });

      socket.to(currentRoomId).emit('player-joined', { id: socket.id, player: sanitizePlayerForClients(player) });
      // Prévient tout le monde que la file d'attente (obligatoire) vient de
      // s'allonger avec ce nouvel arrivant.
      if (!isFirstInRoom) socket.to(currentRoomId).emit('dj-queue-changed', room.djQueue);
    });

    socket.on('move', (pos) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      const p = room && room.players[socket.id];
      if (!p) return;
      p.x = clamp(pos.x, 0, 1);
      p.y = clamp(pos.y, 0, 1);
      socket.to(currentRoomId).emit('player-moved', { id: socket.id, x: p.x, y: p.y });
      // Le DJ n'est plus fige sur une estrade : il se deplace sur la piste comme
      // n'importe quel festivalier et doit donc pouvoir ramasser lui aussi les
      // pieces/bonus/malus et les cases disco (avant, il en etait exclu ici).
      if (room.round.active) {
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

    // Le DJ actuel décide de passer la main tout de suite (bouton "Passer la main") :
    // on solde d'abord son passage (notes -> XP/pièces), puis on avance la file —
    // ce qui le remet lui-même en fin de file (rotation obligatoire et continue).
    socket.on('next-dj', () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room || socket.id !== room.djId) return;
      settleDjTurn(room, currentRoomId);
      advanceDjQueue(room, currentRoomId);
    });

    // Une vidéo vient de se terminer chez le DJ actuel : on solde son passage,
    // puis la main passe automatiquement au joueur suivant dans la file — chacun
    // joue son tour obligatoirement, personne n'a besoin de s'inscrire.
    socket.on('video-ended', () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room || socket.id !== room.djId) return;
      settleDjTurn(room, currentRoomId);
      advanceDjQueue(room, currentRoomId);
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
        const wasInQueue = room.djQueue.includes(socket.id);
        room.djQueue = room.djQueue.filter(id => id !== socket.id);
        io.to(currentRoomId).emit('player-left', { id: socket.id });
        if (wasInQueue) io.to(currentRoomId).emit('dj-queue-changed', room.djQueue);

        // si le DJ partait, la main passe automatiquement au prochain de la file
        // (rotation obligatoire) ; sans personne en attente, à n'importe qui
        // d'autre encore présent. Le DJ qui vient de partir n'est jamais remis
        // dans la file (requeuePrevious: false), puisqu'il n'est plus là.
        if (room.djId === socket.id) {
          const advanced = advanceDjQueue(room, currentRoomId, { requeuePrevious: false });
          if (!advanced) {
            const remainingIds = Object.keys(room.players);
            room.djId = remainingIds.length > 0 ? remainingIds[0] : null;
            if (room.djId) {
              room.djQueue = room.djQueue.filter(id => id !== room.djId);
              room.players[room.djId].bubbleSize = Math.max(room.players[room.djId].bubbleSize, 1.2);
              room.lightEffects.autoMode = true;
              io.to(currentRoomId).emit('light-effects-changed', room.lightEffects);
              io.to(currentRoomId).emit('dj-changed', room.djId);
            }
          }
        }

        cleanupRoomIfEmpty(currentRoomId);
      }
    });
  });
};
