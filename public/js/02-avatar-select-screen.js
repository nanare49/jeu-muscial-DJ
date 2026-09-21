// 02-avatar-select-screen.js
// Écran de sélection d'avatar avant d'entrer dans la salle : type/couleur, personnalisation humaine (cheveux/haut/manches/pantalon/peau), aperçu animé.
// --- écran de sélection d'avatar (obligatoire avant d'entrer dans la salle) ---
const avatarTypes = ['human', 'robot', 'alien', 'ghost', 'dragon', 'blob'];
const avatarTypeLabels = {
  human: 'Festivalier', robot: 'Robot', alien: 'Alien',
  ghost: 'Fantôme', dragon: 'Dragonnet', blob: 'Blob'
};
const avatarColorChoices = ['#ff5fa3', '#5ad1ff', '#ffd35a'];
let avatarTypeIndex = 0;
let avatarColorIndex = 0;

// --- personnalisation modulaire du festivalier (humain) : tête / corps / bras / jambes ---
// Sprites Kenney "Modular Characters" (CC0), triés à la main pour ne garder que ceux
// qui s'assemblent proprement (cf. public/avatars/human/license.txt).
const HUMAN_SPRITE_BASE = '/avatars/human/';
const HUMAN_HAIR_OPTIONS = [
  { hair: 'tete1.png', face: 'face1.png' },
  { hair: 'tete2.png', face: 'face2.png' },
  { hair: 'tete3.png', face: 'face3.png' },
  { hair: 'tete4.png', face: 'face4.png' },
  { hair: 'tete5.png', face: 'face1.png' },
  { hair: 'tete6.png', face: 'face2.png' },
  { hair: 'tete7.png', face: 'face3.png' },
  { hair: 'tete8.png', face: 'face4.png' },
  { hair: 'tete9.png', face: 'face1.png' },
  { hair: 'tete10.png', face: 'face2.png' }
];
const HUMAN_SHIRT_COLORS = [
  { key: 'blue', hex: '#3498db' }, { key: 'green', hex: '#63b448' },
  { key: 'grey', hex: '#95a5a6' }, { key: 'navy', hex: '#34495e' },
  { key: 'pine', hex: '#16a085' }, { key: 'red', hex: '#e05848' },
  { key: 'white', hex: '#eeeeee' }, { key: 'yellow', hex: '#ffcc00' },
  // t-shirts "à motif" (même sprite blanc, juste un dessin différent dessus)
  { key: 'white', hex: '#eeeeee', icon: '🎵' },
  { key: 'white', hex: '#eeeeee', icon: '🍔' },
  { key: 'white', hex: '#eeeeee', icon: '⚡' },
  { key: 'white', hex: '#eeeeee', icon: '🎮' },
  { key: 'white', hex: '#eeeeee', icon: 'DJ' }
];
const HUMAN_SLEEVE_OPTIONS = [
  { key: 'long', label: 'Manches longues', frac: 1.0 },
  { key: 'short', label: 'Manches courtes', frac: 0.55 },
  { key: 'shorter', label: 'Débardeur', frac: 0.12 }
];
const HUMAN_PANTS_COLORS = [
  { key: 'blue1', hex: '#699fb6' }, { key: 'blue2', hex: '#2a81bb' },
  { key: 'brown', hex: '#c4ad83' }, { key: 'green', hex: '#529c39' },
  { key: 'grey', hex: '#7b8f91' }, { key: 'lightblue', hex: '#57afaf' },
  { key: 'navy', hex: '#2a3c4f' }, { key: 'pine', hex: '#108a72' },
  { key: 'red', hex: '#bf493b' }, { key: 'tan', hex: '#c2b7a3' },
  { key: 'white', hex: '#d2d2d2' }, { key: 'yellow', hex: '#e7b900' }
];
const HUMAN_SKIN_TINTS = [
  { key: 'tint1', hex: '#ffe0b1' }, { key: 'tint2', hex: '#f5d29d' },
  { key: 'tint3', hex: '#ffe9c9' }, { key: 'tint4', hex: '#e0bc85' },
  { key: 'tint5', hex: '#d2ac73' }, { key: 'tint6', hex: '#bf9c66' },
  { key: 'tint7', hex: '#aa8956' }, { key: 'tint8', hex: '#957544' }
];
let humanCustom = { hairIndex: 0, shirtIndex: 0, sleeveIndex: 0, pantsIndex: 0, skinIndex: 0 };
function clampIndex(i, len) { return ((Number.isInteger(i) ? i : 0) % len + len) % len; }

// cache d'images pour les sprites (chargées à la demande, réutilisées ensuite)
const _spriteImgCache = {};
function getSpriteImage(relPath) {
  let img = _spriteImgCache[relPath];
  if (!img) {
    img = new Image();
    img.src = HUMAN_SPRITE_BASE + relPath;
    _spriteImgCache[relPath] = img;
  }
  return img;
}
function drawSpriteSafe(c, img, x, y, w, h) {
  if (img.complete && img.naturalWidth > 0) c.drawImage(img, x, y, w, h);
}
function drawSpriteMirrored(c, img, x, y, w, h) {
  if (!(img.complete && img.naturalWidth > 0)) return;
  c.save();
  c.translate(x + w, y);
  c.scale(-1, 1);
  c.drawImage(img, 0, 0, w, h);
  c.restore();
}
function spriteDims(img, fallback) {
  return (img.naturalWidth > 0) ? [img.naturalWidth, img.naturalHeight] : fallback;
}

// on relit les derniers choix faits sur ce navigateur, s'il y en a
let savedAvatarPrefs = null;
try {
  savedAvatarPrefs = JSON.parse(localStorage.getItem('jeuMusicalAvatarPrefs') || 'null');
} catch (e) { /* ignore */ }
if (savedAvatarPrefs) {
  if (Number.isInteger(savedAvatarPrefs.typeIndex) && avatarTypes[savedAvatarPrefs.typeIndex]) {
    avatarTypeIndex = savedAvatarPrefs.typeIndex;
  }
  if (Number.isInteger(savedAvatarPrefs.colorIndex) && avatarColorChoices[savedAvatarPrefs.colorIndex]) {
    avatarColorIndex = savedAvatarPrefs.colorIndex;
  }
  if (savedAvatarPrefs.human && typeof savedAvatarPrefs.human === 'object') {
    humanCustom = {
      hairIndex: clampIndex(savedAvatarPrefs.human.hairIndex, HUMAN_HAIR_OPTIONS.length),
      shirtIndex: clampIndex(savedAvatarPrefs.human.shirtIndex, HUMAN_SHIRT_COLORS.length),
      sleeveIndex: clampIndex(savedAvatarPrefs.human.sleeveIndex, HUMAN_SLEEVE_OPTIONS.length),
      pantsIndex: clampIndex(savedAvatarPrefs.human.pantsIndex, HUMAN_PANTS_COLORS.length),
      skinIndex: clampIndex(savedAvatarPrefs.human.skinIndex, HUMAN_SKIN_TINTS.length)
    };
  }
}

// Identifiant persistant de ce navigateur : c'est lui qui retrouve le profil
// (niveau, XP, pièces, objets achetés) d'une visite à l'autre. Pas un vrai
// compte : pas de mot de passe, juste gardé dans ce navigateur.
let myPlayerToken = null;
try {
  myPlayerToken = localStorage.getItem('jeuMusicalPlayerToken');
} catch (e) { /* ignore */ }
if (!myPlayerToken) {
  myPlayerToken = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'tok-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  try { localStorage.setItem('jeuMusicalPlayerToken', myPlayerToken); } catch (e) { /* ignore */ }
}
let myProfile = { xp: 0, coins: 0, level: 1, xpIntoLevel: 0, xpPerLevel: 100, ownedItems: [] };
let shopCatalog = [];

const avatarPreviewCanvas = document.getElementById('avatar-preview-canvas');
const avatarPreviewCtx = avatarPreviewCanvas.getContext('2d');

const colorRow = document.getElementById('avatar-color-row');
// Sur le festivalier (humain), cette rangée sert à choisir le TEINT DE PEAU
// (les autres couleurs sont maintenant réparties sur les flèches tête/corps/jambes).
// Sur les autres types, elle garde son ancien rôle de couleur générale.
function renderColorRow() {
  colorRow.innerHTML = '';
  const isHuman = avatarTypes[avatarTypeIndex] === 'human';
  const labelEl = document.getElementById('avatar-color-row-label');
  if (labelEl) labelEl.textContent = isHuman ? 'Teint de peau' : 'Couleur';
  const list = isHuman ? HUMAN_SKIN_TINTS : avatarColorChoices.map(c => ({ hex: c }));
  const selectedI = isHuman ? humanCustom.skinIndex : avatarColorIndex;
  list.forEach((item, i) => {
    const sw = document.createElement('div');
    sw.className = 'avatar-color-swatch' + (i === selectedI ? ' selected' : '');
    sw.style.background = item.hex;
    sw.title = isHuman ? 'Teint de peau' : '';
    sw.addEventListener('click', () => {
      if (isHuman) { humanCustom.skinIndex = i; } else { avatarColorIndex = i; }
      colorRow.querySelectorAll('.avatar-color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
    colorRow.appendChild(sw);
  });
}
renderColorRow();

if (savedAvatarPrefs && savedAvatarPrefs.name) {
  document.getElementById('avatar-name-input').value = savedAvatarPrefs.name;
}
updateAvatarTypeLabel();

document.getElementById('avatar-prev-btn').addEventListener('click', () => {
  avatarTypeIndex = (avatarTypeIndex - 1 + avatarTypes.length) % avatarTypes.length;
  updateAvatarTypeLabel();
});
document.getElementById('avatar-next-btn').addEventListener('click', () => {
  avatarTypeIndex = (avatarTypeIndex + 1) % avatarTypes.length;
  updateAvatarTypeLabel();
});
function updateAvatarTypeLabel() {
  document.getElementById('avatar-type-label').textContent = avatarTypeLabels[avatarTypes[avatarTypeIndex]];
  const isHuman = avatarTypes[avatarTypeIndex] === 'human';
  document.getElementById('human-zone-controls').style.display = isHuman ? '' : 'none';
  renderColorRow();
}

// --- flèches proches de chaque zone (tête / corps / bras / jambes), humain uniquement ---
function stepHuman(field, listLen, dir) {
  humanCustom[field] = clampIndex(humanCustom[field] + dir, listLen);
}
document.getElementById('zone-head-prev').addEventListener('click', () => stepHuman('hairIndex', HUMAN_HAIR_OPTIONS.length, -1));
document.getElementById('zone-head-next').addEventListener('click', () => stepHuman('hairIndex', HUMAN_HAIR_OPTIONS.length, 1));
document.getElementById('zone-body-prev').addEventListener('click', () => stepHuman('shirtIndex', HUMAN_SHIRT_COLORS.length, -1));
document.getElementById('zone-body-next').addEventListener('click', () => stepHuman('shirtIndex', HUMAN_SHIRT_COLORS.length, 1));
document.getElementById('zone-arms-prev').addEventListener('click', () => stepHuman('sleeveIndex', HUMAN_SLEEVE_OPTIONS.length, -1));
document.getElementById('zone-arms-next').addEventListener('click', () => stepHuman('sleeveIndex', HUMAN_SLEEVE_OPTIONS.length, 1));
document.getElementById('zone-legs-prev').addEventListener('click', () => stepHuman('pantsIndex', HUMAN_PANTS_COLORS.length, -1));
document.getElementById('zone-legs-next').addEventListener('click', () => stepHuman('pantsIndex', HUMAN_PANTS_COLORS.length, 1));

// Le bouton d'entrée reste désactivé tant que l'avertissement épilepsie/
// photosensibilité n'a pas été explicitement coché.
document.getElementById('epilepsy-ack-checkbox').addEventListener('change', (e) => {
  document.getElementById('avatar-confirm-btn').disabled = !e.target.checked;
});

document.getElementById('avatar-confirm-btn').addEventListener('click', () => {
  const nameInputEl = document.getElementById('avatar-name-input');
  const chosenName = nameInputEl ? nameInputEl.value.trim() : '';

  avatarConfirmed = true;
  document.getElementById('avatar-select-overlay').remove();

  // on retient ce choix dans le navigateur, pour le retrouver automatiquement
  // même après un rechargement de page ou une reconnexion
  try {
    localStorage.setItem('jeuMusicalAvatarPrefs', JSON.stringify({
      typeIndex: avatarTypeIndex,
      colorIndex: avatarColorIndex,
      name: chosenName,
      human: humanCustom
    }));
  } catch (e) { /* stockage indisponible : pas grave, juste moins pratique */ }

  socket.emit('join-room', {
    roomId: requestedRoom,
    avatarType: avatarTypes[avatarTypeIndex],
    avatarColor: avatarColorChoices[avatarColorIndex],
    humanCustom: humanCustom,
    name: chosenName,
    token: myPlayerToken,
    // jusqu'où la piste descend sur CET écran (juste sous la barrière) : sert au
    // serveur à ne jamais faire apparaître un bonus/malus hors d'atteinte.
    minY: stageMinY()
  });
});

let previewMotionState = {};
function avatarPreviewLoop(t) {
  avatarPreviewCtx.clearRect(0, 0, 180, 220);
  drawAvatarByType(
    avatarPreviewCtx, 90, 170, 2.1,
    avatarTypes[avatarTypeIndex], 'idle', 'none',
    avatarColorChoices[avatarColorIndex], false, t, previewMotionState, humanCustom
  );
  requestAnimationFrame(avatarPreviewLoop);
}
requestAnimationFrame(avatarPreviewLoop);

const urlParams = new URLSearchParams(window.location.search);
const requestedRoom = urlParams.get('room') || '';

