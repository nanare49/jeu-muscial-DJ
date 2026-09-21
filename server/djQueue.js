// server/djQueue.js
// Rotation obligatoire de la main DJ : solder le passage qui vient de se
// terminer (récompense forfaitaire + arrêt du mini-jeu), et faire passer la
// main au prochain de la file d'attente.
module.exports = function createDjQueue({ io, profiles, minigame }) {
  const { getOrCreateProfile, publicProfile, scheduleSaveProfiles, levelForXp } = profiles;
  const { endRound } = minigame;

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
  // vrai si la file d'attente est vide (il est seul dans la salle), mais faux
  // dès qu'il a déjà lancé un morceau pendant son passage et qu'au moins une
  // personne attend son tour — il doit d'abord terminer son morceau (la main
  // passe alors automatiquement) plutôt que d'en relancer un autre indéfiniment.
  function djCanStartNewTrack(room) {
    if (room.djQueue.length === 0) return true;
    return !room.currentDjTurn.trackStarted;
  }
  function emitDjTurnState(room, roomId) {
    io.to(roomId).emit('dj-turn-state', { canStartNewTrack: djCanStartNewTrack(room) });
  }

  // Fait passer la main au prochain de la file d'attente (rotation obligatoire).
  // Par défaut, celui qui vient de jouer retourne en fin de file pour rejouer
  // plus tard (options.requeuePrevious: false quand il vient de se déconnecter
  // et n'est donc plus là pour rejouer). Renvoie false si personne n'attend
  // (le DJ actuel garde alors la main, faute d'autre joueur dans la salle).
  function advanceDjQueue(room, roomId, options) {
    const requeuePrevious = !options || options.requeuePrevious !== false;
    if (room.djQueue.length === 0) return false;
    const previousDjId = room.djId;
    const nextDjId = room.djQueue.shift();
    room.djId = nextDjId;

    if (requeuePrevious && previousDjId && room.players[previousDjId] && !room.djQueue.includes(previousDjId)) {
      room.djQueue.push(previousDjId); // chacun joue son tour, puis retourne en fin de file
    }

    // le nouveau DJ garde sa position et sa pose sur la piste, juste une bulle plus grande
    if (room.players[nextDjId]) {
      room.players[nextDjId].bubbleSize = Math.max(room.players[nextDjId].bubbleSize || 1.0, 1.2);
    }

    // Passage de main automatique : les lumières repartent tout de suite en
    // mode "suit la musique" pour le nouveau DJ, qui n'a rien à régler lui-même.
    room.lightEffects.autoMode = true;
    io.to(roomId).emit('light-effects-changed', room.lightEffects);
    io.to(roomId).emit('dj-changed', room.djId);
    io.to(roomId).emit('dj-queue-changed', room.djQueue);
    return true;
  }

  return { settleDjTurn, djCanStartNewTrack, emitDjTurnState, advanceDjQueue };
};
