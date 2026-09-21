// server/minigame.js
// Mini-jeu de ramassage d'objets sur la piste : objets bonus/malus, cases
// disco lumineuses, cycle de vie d'un round (décompte -> actif -> fin), et
// les effets (gain/perte de pièces ou d'XP, vitesse/ralenti/immobilisation,
// poussée) déclenchés en marchant sur un objet.
module.exports = function createMinigame({ io, rooms, config, profiles, ambiance }) {
  const {
    ITEM_TYPE_KEYS, ITEM_TYPES, ROUND_INITIAL_ITEMS, ITEM_LIFETIME_MS,
    ROUND_RESPAWN_MIN_MS, ROUND_RESPAWN_MAX_MS, DISCO_GRID_COLS, DISCO_GRID_ROWS,
    DISCO_TILE_INTERVAL_MIN_MS, DISCO_TILE_INTERVAL_MAX_MS, DISCO_TILE_MAX_LIT,
    DISCO_TILE_PICKUP_RADIUS, DISCO_TILE_COLORS, MUSIC_PULSE_BPM_MIN, MUSIC_PULSE_BPM_MAX,
    STATUS_EFFECT_MS, ITEM_PICKUP_RADIUS, ITEM_PICKUP_COOLDOWN_MS, OPPONENT_MAX_RADIUS,
    clamp, pick
  } = config;
  const { getOrCreateProfile, publicProfile, scheduleSaveProfiles, levelForXp } = profiles;
  const { startAutoAmbiance } = ambiance;

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

  // Cree un objet et programme sa disparition automatique apres
  // ITEM_LIFETIME_MS s'il n'a pas ete ramasse avant (cf. checkItemPickup qui
  // annule ce minuteur en cas de ramassage) : les objets restent peu de temps
  // au sol et un autre reapparait vite ailleurs pour garder un rythme soutenu.
  function spawnItem(room, roomId) {
    const type = ITEM_TYPE_KEYS[Math.floor(Math.random() * ITEM_TYPE_KEYS.length)];
    const id = room.round.nextItemId++;
    const pos = randomFloorPosition(room);
    // Important : ne JAMAIS ajouter de champ non-JSON (comme un Timeout) sur cet
    // objet "item" — il est envoyé tel quel aux clients via socket.io, qui plante
    // (pile d'appels infinie dans hasBinary) si on lui donne un objet circulaire.
    const item = { id, type, x: pos.x, y: pos.y };
    room.round.items[id] = item;
    room.round.itemTimers[id] = setTimeout(() => {
      if (!room.round.items[id]) return; // deja ramasse entre-temps
      delete room.round.items[id];
      delete room.round.itemTimers[id];
      io.to(roomId).emit('item-collected', { itemId: id });
      scheduleItemRespawn(room, roomId);
    }, ITEM_LIFETIME_MS);
    room.round.timers.push(room.round.itemTimers[id]);
    return item;
  }

  // Programme la reapparition d'un objet ailleurs sur la piste apres un court
  // delai aleatoire, utilise a la fois quand un objet est ramasse et quand il
  // disparait tout seul (expiration).
  function scheduleItemRespawn(room, roomId) {
    const delay = ROUND_RESPAWN_MIN_MS + Math.random() * (ROUND_RESPAWN_MAX_MS - ROUND_RESPAWN_MIN_MS);
    const timer = setTimeout(() => {
      if (rooms.get(roomId) !== room || !room.round.active) return;
      spawnItem(room, roomId);
      broadcastRoundItems(room, roomId);
    }, delay);
    room.round.timers.push(timer);
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
    for (let i = 0; i < ROUND_INITIAL_ITEMS; i++) spawnItem(room, roomId);
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
    room.round.itemTimers = {};
    room.round.discoTiles = [];
    room.round.active = false;
    room.round.countdownEndAt = null;
    room.musicPulse = { bpm: null, anchorAt: null };
    room.autoLightsRunning = false;
    room.musicDropRunning = false;
    room.nextDropAt = 0;
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
        // ramassé avant expiration : plus besoin du minuteur d'auto-disparition
        if (room.round.itemTimers[item.id]) clearTimeout(room.round.itemTimers[item.id]);
        delete room.round.itemTimers[item.id];
        delete room.round.items[item.id];
        io.to(roomId).emit('item-collected', { itemId: item.id });
        applyItemEffect(room, roomId, playerId, item.type);
        scheduleItemRespawn(room, roomId);
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

  return {
    clearRoundTimers,
    randomFloorPosition,
    spawnItem,
    scheduleItemRespawn,
    broadcastRoundItems,
    buildDiscoGrid,
    broadcastDiscoTiles,
    lightRandomDiscoTile,
    scheduleDiscoTileTick,
    startRoundCountdown,
    activateRound,
    resetRoundState,
    endRound,
    checkItemPickup,
    checkDiscoTilePickup,
    findNearestOpponent,
    applyStatusEffect,
    pushPlayer,
    applyItemEffect
  };
};
