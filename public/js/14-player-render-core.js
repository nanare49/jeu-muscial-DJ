// 14-player-render-core.js
// Rendu commun à tous les joueurs : accessoires premium, sélection du bon avatar, animation de mouvement, ombre, anneau "c'est moi".
// Rendu des accessoires premium achetés en boutique (slot "accessory", en
// plus de casquette/chapeau/bouée/costume) : lunettes, auréole, ailes, masque
// disco. Partagé par tous les types d'avatar + le DJ pour qu'un objet acheté
// s'affiche bien une fois équipé, quel que soit le personnage.
function drawPremiumAccessory(c, accessory, headY, headR) {
  if (accessory === 'acc_shades') {
    const y = headY - headR * 0.08;
    const w = headR * 0.62, h = headR * 0.4, gap = headR * 0.18;
    c.fillStyle = '#1c1a24';
    roundRect(c, -w - gap / 2, y - h / 2, w, h, h * 0.35);
    c.fill();
    strokeOutline(c, '#1c1a24', 1.6);
    roundRect(c, gap / 2, y - h / 2, w, h, h * 0.35);
    c.fill();
    strokeOutline(c, '#1c1a24', 1.6);
    c.strokeStyle = '#1c1a24';
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-gap / 2, y); c.lineTo(gap / 2, y);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.ellipse(-w * 0.55, y - h * 0.18, w * 0.22, h * 0.16, -0.3, 0, Math.PI * 2);
    c.ellipse(gap / 2 + w * 0.45, y - h * 0.18, w * 0.22, h * 0.16, -0.3, 0, Math.PI * 2);
    c.fill();
  } else if (accessory === 'acc_halo') {
    const y = headY - headR * 1.55;
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#ffe9a8';
    c.beginPath();
    c.ellipse(0, y, headR * 0.85, headR * 0.85, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.strokeStyle = '#ffd35a';
    c.lineWidth = headR * 0.16;
    c.beginPath();
    c.ellipse(0, y, headR * 0.62, headR * 0.2, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = shadeColor('#ffd35a', -30);
    c.lineWidth = headR * 0.16;
    c.beginPath();
    c.ellipse(0, y, headR * 0.62, headR * 0.2, 0, Math.PI * 0.05, Math.PI * 0.95);
    c.stroke();
  } else if (accessory === 'acc_wings') {
    const y = headY + headR * 1.3;
    [-1, 1].forEach(side => {
      c.save();
      c.translate(side * headR * 0.3, y);
      c.scale(side, 1);
      c.fillStyle = '#f2eefb';
      c.beginPath();
      c.ellipse(headR * 1.15, -headR * 0.15, headR * 1.35, headR * 0.6, -0.55, 0, Math.PI * 2);
      c.fill();
      strokeOutline(c, '#f2eefb', 2);
      c.fillStyle = 'rgba(190,180,225,0.55)';
      c.beginPath();
      c.ellipse(headR * 0.95, -headR * 0.1, headR * 0.75, headR * 0.3, -0.55, 0, Math.PI * 2);
      c.fill();
      c.restore();
    });
  } else if (accessory === 'acc_disco') {
    const y = headY - headR * 0.1;
    const r = headR * 0.72;
    c.fillStyle = '#151022';
    c.beginPath();
    c.ellipse(0, y, r, r * 0.62, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#151022', 1.8);
    for (let i = -2; i <= 2; i++) {
      const flicker = (Math.sin(Date.now() / 160 + i * 1.3) + 1) / 2;
      c.fillStyle = `hsl(${(i * 55 + 300) % 360}, 85%, ${55 + flicker * 20}%)`;
      c.beginPath();
      c.arc(i * r * 0.32, y - r * 0.08, r * 0.13, 0, Math.PI * 2);
      c.fill();
    }
  }
}

// avatar vu de dos, style détaillé (grosse tête, corps "chunky", accessoires)
function drawPlayer(p, isMe, t) {
  const cx = p.x * W, cy = p.y * H;
  const scale = isMe ? 1.05 : 0.9;
  // immobilisé par une platine vinyle : on force la pose "danse sur place",
  // visible par tout le monde, tant que l'effet n'est pas retombé.
  const move = (p.statusEffect && p.statusEffect.type === 'frozen') ? 'dance2' : (p.pose || 'idle');
  const accessory = p.accessory || 'none';
  const color = p.avatarColor || p.color || '#8d84a3';
  if (!p._motion) p._motion = {};

  drawAvatarByType(ctx, cx, cy, scale, p.avatarType || 'human', move, accessory, color, isMe, t, p._motion, p.humanCustom);

  // petit badge au-dessus de la tête pour l'effet bonus/malus en cours (le
  // même que l'icône de l'objet ramassé), visible par tout le monde.
  if (p.statusEffect) {
    const badge = STATUS_BADGE_EMOJI[p.statusEffect.type];
    if (badge) {
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badge, cx + 24 * scale, cy - 94 * scale);
    }
  }

  // nom au-dessus
  ctx.fillStyle = '#e9e4f2';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.name || '', cx, cy - 78 * scale);
}

// Dispatche vers le bon dessin selon le type d'avatar choisi à l'entrée.
// Utilisé à la fois par le rendu du jeu et par l'aperçu de l'écran de sélection.
function drawAvatarByType(c, cx, cy, scale, avatarType, move, accessory, color, isMe, t, motionState, humanCustomData) {
  c.save();
  c.translate(cx, cy);
  c.scale(scale, scale);
  const ms = motionState || {};

  if (avatarType === 'robot') drawRobotBody(c, move, accessory, color, isMe, t, ms);
  else if (avatarType === 'alien') drawAlienBody(c, move, accessory, color, isMe, t, ms);
  else if (avatarType === 'ghost') drawGhostBody(c, move, accessory, color, isMe, t, ms);
  else if (avatarType === 'dragon') drawDragonBody(c, move, accessory, color, isMe, t, ms);
  else if (avatarType === 'blob') drawBlobBody(c, move, accessory, color, isMe, t, ms);
  else drawHumanBody(c, move, accessory, color, isMe, t, ms, humanCustomData);

  c.restore();
}

function motionFor(move, t) {
  let armAngle = 0.3, armLift = 0, bob = 0, sway = 0, legSpread = 6;
  if (move === 'idle') { bob = Math.sin(t / 600) * 2; sway = Math.sin(t / 800) * 2; }
  else if (move === 'hands_up') { armLift = 1; bob = Math.abs(Math.sin(t / 260)) * 7; }
  else if (move === 'jump') { armLift = 0.6; bob = Math.abs(Math.sin(t / 200)) * 18; legSpread = 10; }
  else if (move === 'clap') { armLift = 0.75; armAngle = 1.0; bob = Math.abs(Math.sin(t / 240)) * 5; }
  else if (move === 'dance1') { sway = Math.sin(t / 300) * 18; armAngle = 0.5 + Math.sin(t / 300) * 0.4; bob = Math.abs(Math.sin(t / 300)) * 6; }
  else if (move === 'dance2') { sway = Math.sin(t / 200) * 10; armLift = (Math.sin(t / 200) + 1) / 2; bob = Math.abs(Math.cos(t / 200)) * 10; legSpread = 7 + Math.sin(t / 200) * 3; }
  return { armAngle, armLift, bob, sway, legSpread };
}

function drawShadow(c, sway, bob) {
  c.save();
  c.translate(-sway, bob);
  c.fillStyle = 'rgba(0,0,0,0.42)';
  c.beginPath();
  c.ellipse(0, 46, 20, 6, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawSelfRing(c, isMe, cy, r) {
  if (!isMe) return;
  c.strokeStyle = '#fff';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(0, cy, r, 0, Math.PI * 2);
  c.stroke();
}

// deux segments de couleurs différentes pour un même membre (manche + avant-bras nu)
function drawLimbTubeSleeve(c, x1, y1, x2, y2, width, sleeveColor, skinColor, sleeveFrac) {
  if (sleeveFrac >= 0.98) { drawLimbTube(c, x1, y1, x2, y2, width, sleeveColor); return; }
  const mx = x1 + (x2 - x1) * sleeveFrac, my = y1 + (y2 - y1) * sleeveFrac;
  drawLimbTube(c, x1, y1, x2, y2, width * 0.86, skinColor);
  drawLimbTube(c, x1, y1, mx, my, width, sleeveColor);
}

// --- avatar "Festivalier" (humain), personnalisable : tête/corps/bras/jambes ---
// tête = coiffure+visage (10 choix), corps = couleur du haut (8), bras = longueur
// de manche (3, même couleur que le haut), jambes = couleur du pantalon (12),
// + teint de peau (8) choisi séparément. Sprites Kenney en pièces détachées,
// composés ici dans le même repère que l'ancien dessin procédural pour ne rien
// casser côté animation (secousse, saut, danse...).
