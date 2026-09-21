// 03-socket-events-core.js
// Connexion/déconnexion, état de la salle à l'arrivée, et synchronisation des autres joueurs (déplacement, pose, accessoire, DJ actuel, profil).
socket.on('connect', () => {
  syncClock();
});
socket.on('disconnect', () => { statusEl.textContent = 'Déconnecté'; statusEl.className = 'off'; });

let myRoomId = null;
socket.on('room-state', (state) => {
  selfId = state.selfId;
  players = state.players;
  currentDecor = state.decor || 'mainstage';
  document.getElementById('decor-select').value = currentDecor;
  myRoomId = state.roomId;

  statusEl.textContent = 'Connecté — salle ' + state.roomId;
  statusEl.className = 'ok';

  const inviteUrl = window.location.origin + window.location.pathname + '?room=' + state.roomId;
  window.history.replaceState({}, '', inviteUrl);
  document.getElementById('invite-link').value = inviteUrl;

  if (state.currentVideo) {
    applyVideoState(state.currentVideo);
  }

  myDjId = state.djId;
  djQueue = state.djQueue || [];
  canStartNewTrack = state.canStartNewTrack !== false;
  if (state.lightEffects) {
    currentLightEffects = state.lightEffects;
    syncLightEffectsControls();
  }

  // Le serveur peut avoir dû générer un nouveau token (première visite, ou
  // ancien navigateur sans token) : on le garde pour la prochaine fois.
  if (state.token && state.token !== myPlayerToken) {
    myPlayerToken = state.token;
    try { localStorage.setItem('jeuMusicalPlayerToken', myPlayerToken); } catch (e) { /* ignore */ }
  }
  if (state.profile) myProfile = state.profile;
  if (state.shopCatalog) shopCatalog = state.shopCatalog;
  if (state.round) {
    roundActive = !!state.round.active;
    roundItems = state.round.items || [];
    discoTiles = state.round.discoTiles || [];
    roundCountdownEndAt = state.round.countdownEndAt || null;
    musicPulse = state.round.musicPulse || { bpm: null, anchorAt: null };
  }
  renderProfileLine();
  renderShopBox();
  renderAccessoryBar();

  renderBubbleControlBar();
  renderDjQueueUI();
});
socket.on('player-joined', ({ id, player }) => { players[id] = player; });
socket.on('player-left', ({ id }) => { delete players[id]; });
socket.on('player-moved', ({ id, x, y }) => { if (players[id]) { players[id].x = x; players[id].y = y; } });
socket.on('player-posed', ({ id, pose }) => {
  if (players[id]) players[id].pose = pose;
  if (id === selfId) renderPoseBar();
  if (pose === 'dj_front_cannon' && id === myDjId) fireConfetti(W / 2, H * 0.42);
});
socket.on('player-accessory', ({ id, accessory }) => { if (players[id]) players[id].accessory = accessory; });
socket.on('player-bubble-style', ({ id, style }) => { if (players[id]) players[id].bubbleStyle = style; });
socket.on('player-bubble-size', ({ id, size }) => { if (players[id]) players[id].bubbleSize = size; });
socket.on('dj-changed', (djId) => {
  myDjId = djId;
  renderBubbleControlBar();
  renderDjQueueUI();
});
socket.on('profile-updated', (profile) => {
  myProfile = profile;
  renderProfileLine();
  renderShopBox();
  renderAccessoryBar();
});
socket.on('dj-turn-result', (result) => {
  const line = document.createElement('div');
  line.className = 'system-msg';
  let msg = '🎚 Fin du passage de ' + escapeHtml(result.name) + ' : +' + result.xpGain + ' XP, +' + result.coinsGain + ' 🪙';
  if (result.leveledUp) msg += ' — niveau ' + result.level + ' ! 🎉';
  line.textContent = msg;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
});

