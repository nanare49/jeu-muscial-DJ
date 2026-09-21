// 01-bootstrap.js
// Initialisation du canvas (W/H/resize), des cadres déplaçables (⠿), de la connexion socket.io, et de l'état de jeu global partagé (joueurs, décor, file DJ, effets lumineux...).
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W, H;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

// --- déplacement libre des cadres : chacun peut réorganiser son interface
// en attrapant la petite poignée "⠿" dans un coin d'un cadre. La position
// choisie est mémorisée dans ce navigateur (localStorage), par cadre. ---
const draggablePanels = [];
function clampCoord(val, min, max) { return Math.max(min, Math.min(max, val)); }
function makeDraggable(el, storageKey) {
  if (!el) return;
  const handle = el.querySelector(':scope > .drag-handle');
  if (!handle) return;
  draggablePanels.push(el);

  function applyPosition(left, top) {
    const w = el.offsetWidth, h = el.offsetHeight;
    left = clampCoord(left, 4, window.innerWidth - w - 4);
    top = clampCoord(top, 4, window.innerHeight - h - 4);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  }

  try {
    const saved = JSON.parse(localStorage.getItem('jeuMusicalPanelPos_' + storageKey) || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      applyPosition(saved.left, saved.top);
    }
  } catch (e) {}

  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    dragging = true;
    try { handle.setPointerCapture(e.pointerId); } catch (e2) {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyPosition(startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    try {
      const rect = el.getBoundingClientRect();
      localStorage.setItem('jeuMusicalPanelPos_' + storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (e) {}
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}
makeDraggable(document.querySelector('.panel'), 'main');
makeDraggable(document.getElementById('dj-status-box'), 'djstatus');
makeDraggable(document.getElementById('youtube-box'), 'youtube');
makeDraggable(document.getElementById('light-fx-box'), 'lightfx');
makeDraggable(document.getElementById('shop-box'), 'shop');
makeDraggable(document.getElementById('bottom-bars'), 'bottombars');
makeDraggable(document.getElementById('chat-wrap'), 'chat');
window.addEventListener('resize', () => {
  draggablePanels.forEach((el) => {
    if (!el.style.left || el.style.left === 'auto') return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = clampCoord(parseFloat(el.style.left) || 0, 4, window.innerWidth - w - 4);
    const top = clampCoord(parseFloat(el.style.top) || 0, 4, window.innerHeight - h - 4);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  });
});

const statusEl = document.getElementById('status');
const socket = io();

let selfId = null;
let players = {};
let currentDecor = 'mainstage';
let myDjId = null;
let djQueue = []; // file d'attente obligatoire : tout le monde sauf le DJ actuel, chacun joue son tour
let canStartNewTrack = true; // cf. évènement 'dj-turn-state' : un DJ en file ne peut pas relancer avant de céder la main
let currentLightEffects = {
  flash: { on: false, color: '#ff5fa3' },
  laser: { on: false, color: '#5ad1ff', count: 4, style: 'rotating' },
  fireballs: { on: false, color: '#ff7a3d', count: 2 },
  sparks: { on: false, color: '#ffd35a' },
  ledbar: { on: false, color: '#ff5fa3' },
  smoke: { on: false, color: '#cfd6e6', count: 4 },
  power: 0.6, speed: 1.0,
  autoMode: false
};
let avatarConfirmed = false;

