// 25-chat-and-bubbles.js
// Chat texte, et bulles de dialogue au-dessus des avatars.
// --- chat ---
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
document.getElementById('chat-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat', text);
  chatInput.value = '';
}
socket.on('chat-message', ({ id, name, color, text }) => {
  const line = document.createElement('div');
  line.innerHTML = `<b style="color:${color}">${escapeHtml(name)}</b>: ${escapeHtml(text)}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;

  showSpeechBubble(id, color, text);
});
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// --- bulles de dialogue au-dessus des avatars ---
const bubbleLayer = document.getElementById('bubble-layer');
let activeBubbles = []; // { playerId, el }

function showSpeechBubble(playerId, color, text) {
  const p = players[playerId];
  const isDJ = playerId === myDjId;
  const bubbleSize = (p && p.bubbleSize) || (isDJ ? 1.2 : 1.0);
  const bubbleStyle = (p && p.bubbleStyle) || 'plain';

  const bubble = document.createElement('div');
  bubble.className = 'speech-bubble';
  if (isDJ) bubble.classList.add('dj-bubble');
  else if (bubbleStyle === 'dashed') bubble.classList.add('style-dashed');

  bubble.style.setProperty('--bubble-color', isDJ ? '#ffd35a' : (color || '#fff'));
  bubble.style.borderColor = isDJ ? '#ffd35a' : (color || '#fff');
  bubble.style.transform = `translate(-50%, -100%) scale(${bubbleSize})`;
  bubble.style.transformOrigin = '50% 100%';
  bubble.textContent = text;

  if (!isDJ && bubbleStyle === 'stars') {
    const left = document.createElement('span');
    left.className = 'bubble-deco left';
    left.textContent = '✨';
    const right = document.createElement('span');
    right.className = 'bubble-deco right';
    right.textContent = '✨';
    bubble.appendChild(left);
    bubble.appendChild(right);
  }

  bubbleLayer.appendChild(bubble);

  const entry = { playerId, el: bubble };
  activeBubbles.push(entry);
  positionBubble(entry);

  setTimeout(() => {
    bubble.classList.add('fading');
    setTimeout(() => {
      bubble.remove();
      activeBubbles = activeBubbles.filter(b => b !== entry);
    }, 600);
  }, 3200);
}

function positionBubble(entry) {
  const p = players[entry.playerId];
  if (!p) return; // le joueur est parti entre-temps : on laisse la bulle où elle était

  // Si ce joueur a plusieurs bulles actives en même temps (nouveau message envoyé
  // avant que le précédent ait disparu), on les empile verticalement au lieu de
  // les superposer au même endroit : la plus récente reste à sa place habituelle,
  // les plus anciennes remontent au-dessus, dans l'ordre où elles sont arrivées.
  const samePlayerBubbles = activeBubbles.filter(b => b.playerId === entry.playerId);
  const idx = samePlayerBubbles.indexOf(entry);
  const stackOffset = (samePlayerBubbles.length - 1 - idx) * 34;

  if (entry.playerId === myDjId) {
    entry.el.style.left = (W / 2) + 'px';
    entry.el.style.top = (H * 0.42 - 110 - stackOffset) + 'px';
    return;
  }
  const scale = entry.playerId === selfId ? 1.05 : 0.9;
  entry.el.style.left = (p.x * W) + 'px';
  entry.el.style.top = (p.y * H - 90 * scale - stackOffset) + 'px';
}

function renderYoutubeControlsVisibility() {
  const amIDJ = selfId && selfId === myDjId;
  const blocked = amIDJ && !canStartNewTrack;
  document.getElementById('youtube-row').style.display = amIDJ ? 'flex' : 'none';
  document.getElementById('file-track-divider').style.display = amIDJ ? 'block' : 'none';
  document.getElementById('file-track-row').style.display = amIDJ ? 'flex' : 'none';
  document.getElementById('youtube-non-dj-msg').style.display = amIDJ ? 'none' : 'block';
  document.getElementById('youtube-controls').style.display = amIDJ ? 'flex' : 'none';
  document.getElementById('decor-select').disabled = !amIDJ;
  document.getElementById('decor-select').title = amIDJ ? '' : 'Seul le DJ actuel peut changer le décor.';
  document.getElementById('light-fx-box').style.display = amIDJ ? 'block' : 'none';

  // Un DJ qui a fini son morceau ne peut pas en relancer un autre tant qu'il
  // ne cède pas la main, sauf si la file d'attente est vide (cf. dj-turn-state).
  document.getElementById('youtube-launch-btn').disabled = blocked;
  document.getElementById('youtube-input').disabled = blocked;
  document.getElementById('track-file-input').disabled = blocked;
  const turnMsg = document.getElementById('youtube-turn-msg');
  turnMsg.style.display = blocked ? 'block' : 'none';
  if (blocked) {
    turnMsg.textContent = '⏭ Ton tour est terminé : passe la main au DJ suivant (bouton dans le cadre "Musique & file DJ") avant de relancer un morceau.';
  }
}

