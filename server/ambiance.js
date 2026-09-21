// server/ambiance.js
// Petite régie automatique : tant que le DJ a activé le mode auto ET qu'un
// morceau tourne, on change les effets lumineux à intervalles aléatoires
// (façon VJ qui suit l'ambiance) et on programme les "drops" simulés.
// Regroupe volontairement les deux boucles (effets auto + drops) dans un seul
// module : elles s'appellent l'une l'autre (un drop redéclenche tout de suite
// un nouvel effet auto), les séparer aurait juste créé une dépendance
// circulaire entre deux fichiers sans rien clarifier.
module.exports = function createAmbiance({ io, rooms, config }) {
  const {
    pick, MUSIC_DROP_LEAD_MS, MUSIC_DROP_MIN_MS, MUSIC_DROP_MAX_MS, MUSIC_DROP_STROBE_MS,
    AUTO_LIGHTS_MIN_MS, AUTO_LIGHTS_MAX_MS, DROP_PREFERRED_LASER_STYLES, AUTO_LIGHT_COLOR_POOLS,
    validLaserStyles, STROBE_INTENSITY_MAX
  } = config;

  // Pour un lien YouTube, le serveur n'a pas accès au vrai son (impossible
  // d'analyser l'audio d'une iframe tierce) : on ne peut donc pas détecter de
  // vraies séquences (couplet/refrain), mais on connaît quand même le seul
  // repère de structure disponible — le prochain "drop" programmé
  // (room.nextDropAt, cf. scheduleMusicDropTick). On s'en sert pour faire
  // monter l'intensité/la vitesse à l'approche du drop (build-up) et pendant
  // lui, plutôt qu'un tirage complètement indépendant de ce qui joue.
  function currentDropSectionBoost(room) {
    if (!room.nextDropAt) return 0;
    const untilDrop = room.nextDropAt - Date.now();
    if (untilDrop > 0 && untilDrop <= MUSIC_DROP_LEAD_MS) {
      return 1 - untilDrop / MUSIC_DROP_LEAD_MS; // 0 au début du build-up -> 1 juste avant le drop
    }
    if (untilDrop <= 0 && untilDrop > -(MUSIC_DROP_STROBE_MS + 1500)) {
      return 1; // pendant / juste après le drop lui-même
    }
    return 0;
  }

  // Tire un nouvel état d'effets auto, biaisé par la séquence en cours
  // (cf. currentDropSectionBoost) : plus intense/rapide à l'approche d'un drop
  // et pendant lui, plus calme sinon (couplet/normal), pour que la vitesse ET
  // la couleur des effets suivent vraiment l'intensité du morceau plutôt qu'un
  // simple hasard indépendant.
  function generateAutoLightEffects(room) {
    const boost = currentDropSectionBoost(room);
    const colorPool = boost > 0.75 ? AUTO_LIGHT_COLOR_POOLS.drop
      : boost > 0.15 ? AUTO_LIGHT_COLOR_POOLS.buildup
      : AUTO_LIGHT_COLOR_POOLS.normal;
    const laserStyle = boost > 0.4 ? pick(DROP_PREFERRED_LASER_STYLES) : pick(validLaserStyles);
    return {
      flash: { on: Math.random() < 0.7, color: pick(colorPool) },
      laser: {
        on: Math.random() < 0.6 || boost > 0.5,
        color: pick(colorPool),
        count: Math.min(8, 2 + Math.floor(Math.random() * 6) + Math.round(boost * 3)),
        style: laserStyle
      },
      fireballs: {
        on: Math.random() < 0.5 || boost > 0.6,
        color: pick(colorPool),
        count: pick([2, 4, 6, 8])
      },
      sparks: {
        on: Math.random() < 0.5 || boost > 0.4,
        color: pick(colorPool),
        count: 4 + Math.floor(Math.random() * 6),
        intensity: Math.min(1, 0.3 + Math.random() * 0.7 + boost * 0.3)
      },
      ledbar: { on: Math.random() < 0.8, color: pick(colorPool) },
      // "En masse" vraiment sur le drop, jamais en couplet/montée : plus de
      // tirage indépendant au hasard, seul un boost fort (quasi/au moment du
      // drop) déclenche la fumée, et tous les canons d'un coup à ce moment-là.
      smoke: { on: boost > 0.75, color: '#cfd6e6', count: boost > 0.75 ? 7 : (2 + Math.floor(Math.random() * 5)) },
      power: Math.min(1, 0.35 + Math.random() * 0.35 + boost * 0.4),
      speed: Math.min(3, 0.55 + Math.random() * 0.8 + boost * 1.5),
      autoMode: true
    };
  }

  function scheduleAutoLightsTick(room, roomId) {
    room.autoLightsRunning = true;
    const delay = AUTO_LIGHTS_MIN_MS + Math.random() * (AUTO_LIGHTS_MAX_MS - AUTO_LIGHTS_MIN_MS);
    const timer = setTimeout(() => {
      if (rooms.get(roomId) !== room || !room.round.active || !room.lightEffects.autoMode) {
        room.autoLightsRunning = false;
        return;
      }
      room.lightEffects = generateAutoLightEffects(room);
      io.to(roomId).emit('light-effects-changed', room.lightEffects);
      scheduleAutoLightsTick(room, roomId);
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
      room.nextDropAt = dropAt;
      io.to(roomId).emit('music-drop', { dropAt, durationMs: MUSIC_DROP_STROBE_MS, color: '#ffffff', intensity: STROBE_INTENSITY_MAX });
      // Snapshot immédiat au tout début du build-up, puis un second pile au
      // moment du drop : sans ça, le prochain rafraîchissement (aléatoire,
      // 2,5 à 5s, cf. scheduleAutoLightsTick) pourrait tomber n'importe quand et
      // manquer complètement le pic d'intensité attendu pile sur le drop.
      if (room.lightEffects.autoMode) {
        room.lightEffects = generateAutoLightEffects(room);
        io.to(roomId).emit('light-effects-changed', room.lightEffects);
        const dropBoostTimer = setTimeout(() => {
          if (rooms.get(roomId) !== room || !room.round.active || !room.lightEffects.autoMode) return;
          room.lightEffects = generateAutoLightEffects(room);
          io.to(roomId).emit('light-effects-changed', room.lightEffects);
        }, MUSIC_DROP_LEAD_MS);
        room.round.timers.push(dropBoostTimer);
      }
      scheduleMusicDropTick(room, roomId);
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

  return {
    currentDropSectionBoost,
    generateAutoLightEffects,
    scheduleAutoLightsTick,
    scheduleMusicDropTick,
    startAutoAmbiance
  };
};
