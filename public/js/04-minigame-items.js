// 04-minigame-items.js
// Mini-jeu de ramassage d'objets bonus/malus sur la piste : items, dalles disco, effets de statut, stroboscope/tremblement déclenchés par le DJ.
// --- mini-jeu de ramassage d'objets sur la piste (bonus/malus) ---
let roundActive = false;
let roundItems = [];
let discoTiles = [];
let roundCountdownEndAt = null;
let myStatusEffect = null;
// Rythme simulé (BPM + ancrage commun) : la vraie musique vient d'une vidéo
// YouTube intégrée, dont on ne peut pas analyser le son (restriction
// cross-origin), donc ce "beat" est une approximation calée sur le serveur,
// pas une vraie détection audio — cf. commentaire serveur sur MUSIC_PULSE_BPM_MIN.
let musicPulse = { bpm: null, anchorAt: null };
// Renvoie où on en est dans le battement courant (0 = pile sur le temps, se
// rapproche de 1 juste avant le suivant), ou null si aucune musique ne tourne.
function beatPhase() {
  if (!musicPulse || !musicPulse.bpm || !musicPulse.anchorAt) return null;
  const elapsed = serverNow() - musicPulse.anchorAt;
  if (elapsed < 0) return null; // décompte de départ pas encore terminé
  const beatMs = 60000 / musicPulse.bpm;
  return (elapsed % beatMs) / beatMs;
}

const ITEM_EMOJI = {
  coin: '🪙', discoball: '🪩', sneaker: '👟', vip: '🎫', baton: '🥊',
  cocktail: '🍸', syringe: '💉', vinyl: '💿', security: '👮'
};
// même icône que l'objet qui a causé l'effet : sert de petit badge au-dessus
// de la tête du joueur concerné (visible par tout le monde).
const STATUS_BADGE_EMOJI = {
  speed: '👟', slowed: '🎫', frozen: '💿', inverted: '💉', blurred: '🍸'
};

socket.on('round-state', (r) => {
  roundActive = !!r.active;
  roundItems = r.items || [];
  discoTiles = r.discoTiles || [];
  roundCountdownEndAt = r.countdownEndAt || null;
  musicPulse = r.musicPulse || { bpm: null, anchorAt: null };
});
socket.on('round-items', (items) => { roundItems = items || []; });
socket.on('disco-tiles', (tiles) => { discoTiles = tiles || []; });
socket.on('item-collected', ({ itemId }) => {
  roundItems = roundItems.filter(it => it.id !== itemId);
});
socket.on('item-effect', (info) => showItemToast(info));
socket.on('player-effect', ({ id, effect }) => {
  if (players[id]) players[id].statusEffect = effect;
  if (id === selfId) {
    myStatusEffect = effect;
    canvas.style.filter = (effect && effect.type === 'blurred') ? 'blur(4px) saturate(1.3)' : 'none';
  }
});
socket.on('you-were-pushed', ({ x, y }) => {
  myX = x; myY = y;
  if (selfId && players[selfId]) { players[selfId].x = x; players[selfId].y = y; }
});

// "Drop" (stroboscope plein écran) : automatique si le DJ suit la musique
// (cf. mode auto), ou déclenché à la demande depuis le bouton "Flash Drop"
// si le DJ garde la main. Dans les deux cas le serveur prévient tout le
// monde un peu à l'avance (dropAt dans le futur) pour que ça se déclenche
// exactement au même instant chez tout le monde.
let strobeInterval = null;
// Fenêtre d'activation des canons à CO2 montés sur la structure : exactement
// 4 secondes à chaque drop, cf. drawCo2Bursts plus bas (rendu) — on réutilise
// le même événement serveur que le stroboscope, déjà synchronisé (dropAt).
let co2BurstStartAt = 0;
let co2BurstEndAt = 0;
socket.on('music-drop', ({ dropAt, durationMs, color, intensity }) => {
  const delay = Math.max(0, dropAt - serverNow());
  setTimeout(() => triggerStrobe(durationMs || 1400, color || '#ffffff', intensity != null ? intensity : 0.92), delay);
  co2BurstStartAt = dropAt;
  co2BurstEndAt = dropAt + 4000;
});
// Intensité et cadence volontairement limitées (cf. STROBE_PEAK_MAX / demi-
// période ci-dessous) : un stroboscope plein écran, très lumineux et rapide
// (plusieurs flashs par seconde) est un vrai risque pour les personnes
// photosensibles/épileptiques — les recommandations d'accessibilité (WCAG)
// déconseillent plus de 3 flashs par seconde pour du contenu à fort contraste.
// On reste ici sous cette limite même si le serveur envoyait une valeur plus
// élevée (défense en profondeur).
const STROBE_PEAK_MAX = 0.45;
const STROBE_HALF_PERIOD_MS = 180; // cycle complet ~360ms ⇒ moins de 3 flashs/s
function triggerStrobe(durationMs, color, intensity) {
  const overlay = document.getElementById('strobe-overlay');
  if (!overlay) return;
  if (strobeInterval) clearInterval(strobeInterval);
  overlay.style.background = color || '#ffffff';
  const peak = Math.min(STROBE_PEAK_MAX, intensity != null ? intensity : 0.35);
  const start = performance.now();
  overlay.style.display = 'block';
  strobeInterval = setInterval(() => {
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) {
      clearInterval(strobeInterval);
      strobeInterval = null;
      overlay.style.opacity = '0';
      overlay.style.display = 'none';
      return;
    }
    const on = Math.floor(elapsed / STROBE_HALF_PERIOD_MS) % 2 === 0;
    overlay.style.opacity = on ? String(peak) : '0';
  }, 35);
}

// "Tremblement" (secousse de la piste) : automatique en rythme si le DJ suit
// la musique, ou déclenché à la demande (intensité + nombre de répétitions
// choisis par le DJ) s'il garde la main sur les effets.
let manualShake = null;
socket.on('music-shake', ({ startAt, intensity, repeatCount, periodMs }) => {
  manualShake = { startAt, intensity, repeatCount, periodMs };
});

function showItemToast(info) {
  const line = document.createElement('div');
  line.className = 'system-msg';
  if (info.type === 'coins') line.textContent = '🪙 +' + info.gain + ' pièces !';
  else if (info.type === 'xp') line.textContent = '🪩 +' + info.gain + ' XP !' + (info.leveledUp ? ' — niveau ' + info.level + ' ! 🎉' : '');
  else if (info.type === 'lose_coins') line.textContent = info.loss > 0 ? ('👮 -' + info.loss + ' pièces...') : '👮 L’agent de sécurité rôde, mais tu n’as rien à te faire prendre.';
  else return;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function updateRoundCountdownUI() {
  const el = document.getElementById('round-countdown');
  if (!roundCountdownEndAt || roundActive) { el.style.display = 'none'; return; }
  const msLeft = roundCountdownEndAt - serverNow();
  if (msLeft <= 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.textContent = String(Math.ceil(msLeft / 1000));
}
setInterval(updateRoundCountdownUI, 150);

function drawRoundItems(t) {
  if (!roundActive || !roundItems.length) return;
  roundItems.forEach(item => {
    const x = item.x * W, y = item.y * H + Math.sin(t / 300 + item.id) * 4;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ITEM_EMOJI[item.type] || '❔', x, y);
    ctx.restore();
  });
  ctx.textBaseline = 'alphabetic';
}

// Piste lumineuse façon dancefloor disco : toute la piste est quadrillée de
// cases éteintes, dont certaines s'allument de temps en temps dans une
// couleur au hasard (pas toujours la même) et rapportent 1 à 5 pièces à qui
// marche dessus. Mêmes dimensions de grille que côté serveur (cf.
// DISCO_GRID_COLS/DISCO_GRID_ROWS dans server.js), juste pour calculer une
// taille de case cohérente à l'écran.
const DISCO_GRID_COLS = 14;
const DISCO_GRID_ROWS = 5;
function drawDiscoTiles(t) {
  if (!roundActive || !discoTiles.length) return;
  const tileW = (W * 0.84) / DISCO_GRID_COLS;
  const tileH = (H * 0.30) / DISCO_GRID_ROWS;
  const size = Math.max(12, Math.min(tileW, tileH) * 0.8);
  discoTiles.forEach(tile => {
    const x = tile.x * W, y = tile.y * H;
    ctx.save();
    if (tile.lit) {
      const rgb = hexToRgb(tile.color || '#ffd35a');
      const pulse = 0.75 + Math.sin(t / 180 + tile.id) * 0.25;
      ctx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`;
      ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.55 + 0.25 * pulse})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
  });
}
socket.on('dj-queue-changed', (queue) => { djQueue = queue; renderDjQueueUI(); });
socket.on('dj-turn-state', ({ canStartNewTrack: c }) => { canStartNewTrack = c; renderYoutubeControlsVisibility(); });
socket.on('light-effects-changed', (le) => { currentLightEffects = le; syncLightEffectsControls(); });
socket.on('decor-changed', (decor) => {
  currentDecor = decor;
  document.getElementById('decor-select').value = decor;
});

document.getElementById('decor-select').addEventListener('change', (e) => {
  socket.emit('decor', e.target.value);
});


