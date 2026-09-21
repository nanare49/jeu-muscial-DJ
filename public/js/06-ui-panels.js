// 06-ui-panels.js
// Barres d'UI secondaires : taille des bulles de dialogue, poses, accessoires, profil (niveau/XP), boutique, bouton copier le lien.
// --- panneau adapté au rôle : curseur de taille pour le DJ, décor de bulle pour les autres ---
function renderBubbleControlBar() {
  const bar = document.getElementById('bubbleControlBar');
  bar.innerHTML = '';
  const amIDJ = selfId && selfId === myDjId;

  if (amIDJ) {
    const label = document.createElement('span');
    label.textContent = 'Taille de ta bulle :';
    label.style.fontSize = '12px';
    label.style.alignSelf = 'center';
    label.style.color = 'var(--muted)';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1'; slider.max = '1.6'; slider.step = '0.1';
    slider.value = (players[selfId] && players[selfId].bubbleSize) || 1.2;
    slider.addEventListener('input', () => socket.emit('bubble-size', parseFloat(slider.value)));
    bar.appendChild(label);
    bar.appendChild(slider);
  } else {
    const styles = [
      { id: 'plain', label: 'Simple' },
      { id: 'dashed', label: 'Pointillé' },
      { id: 'stars', label: 'Étoiles' }
    ];
    const myStyle = (players[selfId] && players[selfId].bubbleStyle) || 'plain';
    styles.forEach(s => {
      const btn = document.createElement('div');
      btn.className = 'btn' + (s.id === myStyle ? ' active' : '');
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        socket.emit('bubble-style', s.id);
        bar.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      bar.appendChild(btn);
    });
  }
}

// --- poses et accessoires ---
const festivalierPoses = ['idle', 'hands_up', 'jump', 'clap', 'dance1', 'dance2'];
const festivalierPoseLabels = { idle: 'Repos', hands_up: 'Mains en l\u2019air', jump: 'Saute', clap: 'Applaudit', dance1: 'Danse 1', dance2: 'Danse 2' };
// Le DJ n'est plus fige sur une estrade avec des poses dediees ("derriere les
// platines"...) : il est sur la piste comme tout le monde et partage les memes
// poses/animations.
const poseBar = document.getElementById('poseBar');

function renderPoseBar() {
  const list = festivalierPoses;
  const labels = festivalierPoseLabels;
  const currentPose = (players[selfId] && players[selfId].pose) || 'idle';


  poseBar.innerHTML = '';
  list.forEach(p => {
    const btn = document.createElement('div');
    btn.className = 'btn' + (p === currentPose ? ' active' : '');
    btn.textContent = labels[p];
    btn.addEventListener('click', () => {
      socket.emit('pose', p);
      poseBar.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    poseBar.appendChild(btn);
  });
}

const freeAccessories = [
  { id: 'none', label: 'Aucun' },
  { id: 'cap', label: 'Casquette' },
  { id: 'hat', label: 'Chapeau' },
  { id: 'buoy', label: 'Bouée' },
  { id: 'costume', label: 'Costume' }
];
const accessoryBar = document.getElementById('accessoryBar');

// Reconstruit la barre d'accessoires : les gratuits, plus les objets de la
// boutique déjà achetés (ceux non achetés n'apparaissent pas ici — on les
// achète depuis la boutique). Appelée au chargement et à chaque mise à jour
// du profil (un achat vient de débloquer un nouvel objet).
function renderAccessoryBar() {
  const ownedPremium = shopCatalog.filter(item => item.slot === 'accessory' && myProfile.ownedItems.includes(item.id));
  const all = freeAccessories.concat(ownedPremium.map(item => ({ id: item.id, label: (item.emoji ? item.emoji + ' ' : '') + item.label })));
  const currentAccessory = (players[selfId] && players[selfId].accessory) || 'none';

  accessoryBar.innerHTML = '';
  all.forEach(a => {
    const btn = document.createElement('div');
    btn.className = 'btn' + (a.id === currentAccessory ? ' active' : '');
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      socket.emit('accessory', a.id);
      accessoryBar.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    accessoryBar.appendChild(btn);
  });
}
renderAccessoryBar();

// --- profil (niveau/XP/pièces), boutique, et notes données au DJ ---
function renderProfileLine() {
  document.getElementById('profile-line').innerHTML =
    'Niveau ' + myProfile.level + ' · <span id="profile-xp">' + myProfile.xpIntoLevel + '/' + myProfile.xpPerLevel + ' XP</span>'
    + ' · 🪙 <span id="profile-coins">' + myProfile.coins + '</span>';
}
renderProfileLine();

function renderShopBox() {
  const list = document.getElementById('shop-items');
  list.innerHTML = '';
  shopCatalog.forEach(item => {
    const owned = myProfile.ownedItems.includes(item.id);
    const row = document.createElement('div');
    row.className = 'shop-item';
    const label = document.createElement('div');
    label.className = 'shop-item-label';
    label.textContent = (item.emoji ? item.emoji + ' ' : '') + item.label + ' — ' + item.price + ' 🪙';
    const btn = document.createElement('button');
    if (owned) {
      btn.textContent = 'Possédé ✓';
      btn.disabled = true;
    } else if (myProfile.coins < item.price) {
      btn.textContent = 'Pas assez de pièces';
      btn.disabled = true;
    } else {
      btn.textContent = 'Acheter';
      btn.addEventListener('click', () => socket.emit('buy-item', item.id));
    }
    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  });
}
renderShopBox();

document.getElementById('shop-toggle-btn').addEventListener('click', () => {
  const box = document.getElementById('shop-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

// Le cadre "Danses & style" (poses, accessoires/gadgets, taille de la bulle)
// reste replié par défaut : il prenait trop de place en permanence au milieu
// de la piste. On le déplie/replie avec ce bouton, comme la boutique.
document.getElementById('dance-toggle-btn').addEventListener('click', () => {
  const box = document.getElementById('bottom-bars');
  box.style.display = box.style.display === 'none' ? 'flex' : 'none';
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const input = document.getElementById('invite-link');
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => {});
});

