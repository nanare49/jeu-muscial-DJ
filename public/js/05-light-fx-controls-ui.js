// 05-light-fx-controls-ui.js
// Panneau DJ « Effets lumineux » : lecture des contrôles, envoi au serveur, synchronisation de l'UI, file d'attente DJ.
// --- effets lumineux (contrôlés par le DJ, visibles par tout le monde) ---
function currentFxStateFromControls() {
  return {
    flash: { on: document.getElementById('fx-flash-on').checked, color: document.getElementById('fx-flash-color').value },
    laser: {
      on: document.getElementById('fx-laser-on').checked,
      color: document.getElementById('fx-laser-color').value,
      count: parseInt(document.getElementById('fx-laser-count').value, 10),
      style: document.getElementById('fx-laser-style').value
    },
    fireballs: {
      on: document.getElementById('fx-fireballs-on').checked,
      color: document.getElementById('fx-fireballs-color').value,
      count: parseInt(document.getElementById('fx-fireballs-count').value, 10)
    },
    sparks: {
      on: document.getElementById('fx-sparks-on').checked,
      color: document.getElementById('fx-sparks-color').value,
      count: parseInt(document.getElementById('fx-sparks-count').value, 10),
      intensity: parseFloat(document.getElementById('fx-sparks-intensity').value)
    },
    ledbar: { on: document.getElementById('fx-ledbar-on').checked, color: document.getElementById('fx-ledbar-color').value },
    smoke: { on: document.getElementById('fx-smoke-on').checked, color: document.getElementById('fx-smoke-color').value, count: parseInt(document.getElementById('fx-smoke-count').value, 10) },
    power: parseFloat(document.getElementById('fx-power').value),
    speed: parseFloat(document.getElementById('fx-speed').value),
    autoMode: document.getElementById('fx-auto-on').checked
  };
}
function sendLightEffects() {
  document.getElementById('fx-laser-count-val').textContent = document.getElementById('fx-laser-count').value;
  document.getElementById('fx-sparks-count-val').textContent = document.getElementById('fx-sparks-count').value;
  socket.emit('set-light-effects', currentFxStateFromControls());
}
const fxControlIds = [
  'fx-flash-on', 'fx-flash-color',
  'fx-laser-on', 'fx-laser-color', 'fx-laser-count', 'fx-laser-style',
  'fx-fireballs-on', 'fx-fireballs-color', 'fx-fireballs-count',
  'fx-sparks-on', 'fx-sparks-color', 'fx-sparks-count', 'fx-sparks-intensity',
  'fx-ledbar-on', 'fx-ledbar-color',
  'fx-smoke-on', 'fx-smoke-color', 'fx-smoke-count',
  'fx-power', 'fx-speed'
];
fxControlIds.forEach(id => {
  const el = document.getElementById(id);
  const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
  el.addEventListener(evt, sendLightEffects);
});
// Case "suivre la musique automatiquement" : quand le DJ l'active, le serveur
// prend la main sur tous les réglages ci-dessus (cf. syncLightEffectsControls,
// qui grise les contrôles manuels tant qu'elle est cochée).
document.getElementById('fx-auto-on').addEventListener('change', sendLightEffects);

// --- Flash Drop (stroboscope) et Tremblement : déclenchés à la demande par
// le DJ quand il garde la main (grisés comme le reste en mode auto, où c'est
// la régie automatique qui décide seule quand ça se déclenche). ---
document.getElementById('fx-strobe-duration').addEventListener('input', () => {
  document.getElementById('fx-strobe-duration-val').textContent = document.getElementById('fx-strobe-duration').value;
});
document.getElementById('fx-shake-repeat').addEventListener('input', () => {
  document.getElementById('fx-shake-repeat-val').textContent = document.getElementById('fx-shake-repeat').value;
});
document.getElementById('fx-strobe-trigger-btn').addEventListener('click', () => {
  socket.emit('trigger-strobe', {
    color: document.getElementById('fx-strobe-color').value,
    intensity: parseFloat(document.getElementById('fx-strobe-intensity').value),
    durationMs: parseInt(document.getElementById('fx-strobe-duration').value, 10)
  });
});
document.getElementById('fx-shake-trigger-btn').addEventListener('click', () => {
  socket.emit('trigger-shake', {
    intensity: parseFloat(document.getElementById('fx-shake-intensity').value),
    repeatCount: parseInt(document.getElementById('fx-shake-repeat').value, 10)
  });
});

// met les contrôles visuels en accord avec l'état reçu (utile pour les non-DJ
// qui rejoignent en cours de route, et pour rester synchro après une reconnexion)
function syncLightEffectsControls() {
  const le = currentLightEffects;
  document.getElementById('fx-flash-on').checked = le.flash.on;
  document.getElementById('fx-flash-color').value = le.flash.color;
  document.getElementById('fx-laser-on').checked = le.laser.on;
  document.getElementById('fx-laser-color').value = le.laser.color;
  document.getElementById('fx-laser-count').value = le.laser.count;
  document.getElementById('fx-laser-count-val').textContent = le.laser.count;
  document.getElementById('fx-laser-style').value = le.laser.style;
  document.getElementById('fx-fireballs-on').checked = le.fireballs.on;
  document.getElementById('fx-fireballs-color').value = le.fireballs.color;
  document.getElementById('fx-fireballs-count').value = le.fireballs.count || 2;
  document.getElementById('fx-sparks-on').checked = le.sparks.on;
  document.getElementById('fx-sparks-color').value = le.sparks.color;
  document.getElementById('fx-sparks-count').value = le.sparks.count;
  document.getElementById('fx-sparks-count-val').textContent = le.sparks.count;
  document.getElementById('fx-sparks-intensity').value = le.sparks.intensity;
  document.getElementById('fx-ledbar-on').checked = le.ledbar.on;
  document.getElementById('fx-ledbar-color').value = le.ledbar.color;
  if (le.smoke) {
    document.getElementById('fx-smoke-on').checked = le.smoke.on;
    document.getElementById('fx-smoke-color').value = le.smoke.color;
    document.getElementById('fx-smoke-count').value = le.smoke.count || 4;
  }
  document.getElementById('fx-power').value = le.power;
  document.getElementById('fx-speed').value = le.speed;
  document.getElementById('fx-auto-on').checked = !!le.autoMode;
  const manualBox = document.getElementById('fx-manual-controls');
  manualBox.style.opacity = le.autoMode ? '0.4' : '1';
  manualBox.style.pointerEvents = le.autoMode ? 'none' : 'auto';
}

// Tout le monde dans la salle joue son tour de DJ, automatiquement et dans
// l'ordre d'arrivée : plus besoin de s'inscrire ni de pouvoir se désinscrire.
// Ce cadre affiche juste l'ordre de passage ; seul le DJ actuel voit un
// bouton, pour céder la main tout de suite plutôt que d'attendre la fin du
// morceau (le passage automatique se fait de toute façon à la fin).
function renderDjQueueUI() {
  renderYoutubeControlsVisibility();
  renderPoseBar();

  const queueBtn = document.getElementById('dj-queue-btn');
  const queueList = document.getElementById('dj-queue-list');

  queueList.innerHTML = '';
  if (djQueue.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dj-queue-empty';
    empty.textContent = 'Personne d’autre pour l’instant.';
    queueList.appendChild(empty);
  } else {
    djQueue.forEach((id, i) => {
      const li = document.createElement('li');
      if (id === selfId) li.style.outline = '1px solid rgba(255,255,255,0.35)';
      const pos = document.createElement('span');
      pos.className = 'dj-queue-pos';
      pos.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = ((players[id] && players[id].name) || '?') + (id === selfId ? ' (toi)' : '');
      li.appendChild(pos);
      li.appendChild(name);
      queueList.appendChild(li);
    });
  }

  const amIDJ = selfId === myDjId;
  queueBtn.style.display = amIDJ ? 'block' : 'none';
  if (amIDJ) {
    queueBtn.textContent = '⏭ Passer la main';
    queueBtn.disabled = djQueue.length === 0;
    queueBtn.onclick = () => socket.emit('next-dj');
  }
}

