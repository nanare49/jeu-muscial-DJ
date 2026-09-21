// 08-decor-background.js
// Fond de scène commun à tous les décors : confettis, éclairage ambiant de la salle, fond dégradé, et le système d'écran(s) LED géant(s) avec la pieuvre (varie selon le décor).
// --- rendu du décor ---
const decorThemes = {
  mainstage: { sky1: '#241a33', sky2: '#08060c', stage: '#171223', accent: 'rgba(255,196,90,0.55)' },
  mainstage_arena: { sky1: '#1b2140', sky2: '#05060c', stage: '#14121c', accent: 'rgba(120,200,255,0.55)' },
  mainstage_circus: { sky1: '#3a1730', sky2: '#0c0610', stage: '#4a2038', accent: 'rgba(255,140,90,0.55)' },
  mainstage_electro: { sky1: '#0c1a2e', sky2: '#03060c', stage: '#0f1420', accent: 'rgba(70,255,220,0.6)' },
  nightclub: { sky1: '#1a1024', sky2: '#040308', stage: '#0d0a14', accent: 'rgba(120,90,255,0.5)' },
  wheatfield: { sky1: '#3a2f1a', sky2: '#120e08', stage: '#2b2312', accent: 'rgba(255,200,90,0.5)' }
};
// --- confettis (canon du DJ) ---
let confettiParticles = [];
function fireConfetti(originX, originY) {
  for (let i = 0; i < 90; i++) {
    const spread = (Math.random() - 0.5) * 1.6;
    confettiParticles.push({
      x: originX, y: originY,
      vx: Math.sin(spread) * (3 + Math.random() * 5),
      vy: -(6 + Math.random() * 6) + Math.random() * 2,
      hue: Math.random() * 360,
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 20,
      life: 90 + Math.random() * 40
    });
  }
}
function updateAndDrawConfetti() {
  confettiParticles = confettiParticles.filter(c => c.life > 0);
  confettiParticles.forEach(c => {
    c.x += c.vx; c.y += c.vy; c.vy += 0.18; c.rot += c.vrot; c.life -= 1;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot * Math.PI / 180);
    ctx.fillStyle = `hsl(${c.hue}, 85%, 65%)`;
    ctx.fillRect(-4, -6, 8, 12);
    ctx.restore();
  });
}

function shadeColor(hex, percent) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) + Math.round(2.55 * percent);
  let g = ((num >> 8) & 0xff) + Math.round(2.55 * percent);
  let b = (num & 0xff) + Math.round(2.55 * percent);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + (r * 65536 + g * 256 + b).toString(16).padStart(6, '0');
}

// Position verticale fixe du DJ sur scène (utilisée aussi par le podium et les confettis).
function stageCenterY() { return H * 0.42; }

// Bornes du podium surélevé du DJ : le public ne peut pas y marcher (cf. stageMinY).
function stagePlatformBounds() {
  const topY = stageCenterY() + 58;
  const botY = topY + 70;
  const halfW = Math.min(W * 0.22, 260);
  return { topY, botY, halfW, cx: W / 2 };
}

// Limite haute (fraction 0..1) jusqu'où un festivalier peut marcher : juste sous
// la barrière qui longe le devant du podium — impossible de monter sur scène.
function stageMinY() {
  const { botY } = stagePlatformBounds();
  return Math.min(0.8, botY / H + 0.03);
}

// Calcule un niveau d'"activité lumineuse" 0..1 à partir des effets réellement
// actifs (flash, laser, spots LED, boules de feu, étincelles, fumée), pondéré
// par leur puissance : peu/pas d'effets allumés -> activité proche de 0 (salle
// sombre), beaucoup d'effets puissants -> activité proche de 1 (salle bien
// éclairée). Sert de base à drawAmbientRoomLighting pour que la lumière agisse
// vraiment sur la luminosité et la couleur de toute la salle, pas seulement sur
// les éléments graphiques de chaque effet pris isolément.
function roomLightingActivity(le) {
  if (!le) return 0;
  let score = 0;
  if (le.flash && le.flash.on) score += 1.0;
  if (le.laser && le.laser.on) score += 0.85;
  if (le.ledbar && le.ledbar.on) score += 0.7;
  if (le.fireballs && le.fireballs.on) score += 0.6;
  if (le.sparks && le.sparks.on) score += 0.5;
  if (le.smoke && le.smoke.on) score += 0.3;
  score = Math.min(1, score) * Math.max(0.15, le.power);
  return Math.min(1, score);
}

// Assombrit (ou éclaire) et teinte VRAIMENT toute la salle — décor, structure,
// festivaliers compris — en fonction des effets lumineux actifs, comme dans une
// vraie boîte de nuit ou un festival de nuit : salle sombre quand peu/pas
// d'effets tournent, salle bien éclairée et colorée par la couleur de l'effet
// dominant quand ça tourne à fond (drop, flash...). Dessiné en tout dernier,
// par-dessus tout le reste de la scène (comme drawMusicPulseOverlay/
// drawFlashEffect), pour que l'assombrissement/la teinte touchent vraiment tout.
function drawAmbientRoomLighting(t) {
  const le = getEffectiveLightEffects();
  const activity = roomLightingActivity(le);

  // base sombre : forte quand rien ne tourne (plus sombre qu'avant), presque
  // absente une fois les jeux de lumière bien lancés.
  const darkAlpha = 0.5 - activity * 0.42;
  if (darkAlpha > 0.01) {
    ctx.fillStyle = `rgba(4,3,8,${darkAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (le && activity > 0.03) {
    const rgb = hexToRgb(activeLightTint());
    // légère respiration pour que la teinte ne soit pas totalement statique
    const breathe = 0.85 + 0.15 * Math.sin(t / 900);
    const washAlpha = Math.min(0.38, activity * 0.34 * breathe);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${washAlpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function drawBackground(t, pulseEnv) {
  const theme = decorThemes[currentDecor] || decorThemes.mainstage;
  const grad = ctx.createRadialGradient(W/2, H*0.2, 50, W/2, H*0.2, W*0.75);
  grad.addColorStop(0, theme.sky1);
  grad.addColorStop(1, theme.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (currentDecor === 'mainstage') drawMainstageTemple(theme, t);
  else if (currentDecor === 'mainstage_arena') drawMainstageArena(theme, t);
  else if (currentDecor === 'mainstage_circus') drawMainstageCircus(theme, t);
  else if (currentDecor === 'mainstage_electro') drawMainstageElectro(theme, t);
  else drawGenericStageBackdrop(theme);

  drawTrussStructure(theme, t, pulseEnv || 0);

  drawDjBigScreen(t, pulseEnv || 0);

  drawStagePlatform(theme);
  drawStageDeckProp(theme);
  drawCrowdBarrier();
}

// ancien décor générique (boîte de nuit / champ de blé) : un simple bandeau de scène.
function drawGenericStageBackdrop(theme) {
  ctx.fillStyle = theme.stage;
  ctx.fillRect(W * 0.24, H * 0.05, W * 0.52, H * 0.13);
  ctx.fillStyle = theme.accent;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(W * 0.30 + i * (W * 0.4 / 5), H * 0.11, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- grand écran derrière le DJ : une animation "VJ" (grille en perspective +
// anneaux qui pulsent) avec un personnage alien stylisé, qui réagit aux
// effets lumineux (teinte reprise de l'effet actif) et au rythme (pulseEnv,
// cf. loop()). Un vrai moteur 3D (three.js) aurait été disproportionné pour
// un seul écran dans un jeu tout en Canvas 2D : ce rendu 2D "façon 3D"
// (dégradés, ombrage, lueur, grille en perspective) reste cohérent avec le
// style du reste du jeu, et ne reprend aucun personnage existant. Commun aux
// 5 décors (au-dessus de leur propre fond de scène, quel qu'il soit). ---
function djScreenBounds() {
  const cx = W / 2;
  const width = Math.min(W * 0.6, 640);
  const height = width * 0.56;
  const x = cx - width / 2;
  const y = H * 0.055;
  return { x, y, width, height, cx, cy: y + height / 2 };
}

// Couleur "active" à reprendre pour teinter l'écran : celle du premier effet
// lumineux allumé (flash en priorité, puis laser, spots LED, etc.), ou une
// teinte neutre si rien n'est allumé.
function activeLightTint() {
  const le = getEffectiveLightEffects();
  if (!le) return '#7ee0ff';
  if (le.flash && le.flash.on) return le.flash.color;
  if (le.laser && le.laser.on) return le.laser.color;
  if (le.ledbar && le.ledbar.on) return le.ledbar.color;
  if (le.fireballs && le.fireballs.on) return le.fireballs.color;
  if (le.sparks && le.sparks.on) return le.sparks.color;
  return '#7ee0ff';
}

// Zone horizontale "sûre" pour placer les écrans latéraux : les panneaux de
// l'interface (musique, effets lumineux, file DJ...) ont une largeur fixe
// d'environ 260-280px de chaque côté qui ne suit PAS W en proportion — une
// marge en fraction de W ferait disparaître les écrans sous ces panneaux sur
// les fenêtres plus étroites. On reste donc à une distance fixe des deux bords.
function safeSideZone() {
  const sideMargin = 300;
  const left = sideMargin;
  const right = Math.max(left + 60, W - sideMargin);
  return { left, right, width: right - left };
}

// Grande roue de cirque (position + rayon), utilisée à la fois pour dessiner
// la structure de la roue (drawCircusFerrisWheel, cf. drawMainstageCircus) et
// pour placer l'écran LED rond en son centre (cf. vjScreenLayout) — les deux
// doivent toujours coïncider exactement.
function circusWheelSpec() {
  const { left, right } = safeSideZone();
  const r = Math.min(58, (right - left) * 0.16);
  const y = H * 0.24;
  return [
    { cx: left + r, cy: y, r },
    { cx: right - r, cy: y, r },
  ];
}

// Emplacement du/des écran(s) LED "vidéo" du DJ (avec la pieuvre), qui varie
// selon le décor choisi par le DJ :
// - Mainstage Temple : deux écrans, un de chaque côté de la scène.
// - Mainstage Arena : un seul long écran, entre la trusse de projecteurs
//   mobiles (en haut) et la rangée de lumières fixées en haut de la barrière
//   en acier (en bas) — la pieuvre s'y déplace de gauche à droite.
// - Mainstage Cirque : deux écrans ronds, à l'intérieur de la grande roue de
//   chaque côté de la scène.
// - Mainstage Electro / Boîte de nuit / Champ de blé : inchangé, un seul
//   grand écran central derrière les platines (cf. djScreenBounds).
function vjScreenLayout() {
  const { left: safeLeft, right: safeRight, width: safeWidth } = safeSideZone();

  if (currentDecor === 'mainstage') {
    const width = Math.min(150, safeWidth * 0.34), height = width * 1.05, y = H * 0.10;
    return [
      { shape: 'rect', x: safeLeft, y, width, height, phase: 0 },
      { shape: 'rect', x: safeRight - width, y, width, height, phase: 2.4 },
    ];
  }
  if (currentDecor === 'mainstage_arena') {
    const x = safeLeft, y = H * 0.175, width = safeWidth, height = H * 0.15;
    return [{ shape: 'rect', x, y, width, height, sweep: true, phase: 0 }];
  }
  if (currentDecor === 'mainstage_circus') {
    return circusWheelSpec().map((w, i) => ({ shape: 'circle', cx: w.cx, cy: w.cy, r: w.r, phase: i * 2.4 }));
  }
  const { x, y, width, height } = djScreenBounds();
  return [{ shape: 'rect', x, y, width, height, phase: 0 }];
}

function drawDjBigScreen(t, pulseEnv) {
  vjScreenLayout().forEach(screen => drawVjScreenPanel(t, pulseEnv, screen));
}

// Dessine un écran (rectangulaire ou rond) avec son cadre lumineux et la
// pieuvre à l'intérieur — factorise ce qui était autrefois l'unique écran
// central pour pouvoir en afficher plusieurs, à des formes/tailles différentes,
// selon le décor (cf. vjScreenLayout).
function drawVjScreenPanel(t, pulseEnv, screen) {
  const tint = activeLightTint();
  const rgb = hexToRgb(tint);
  const glowAlpha = 0.35 + pulseEnv * 0.45;
  // léger déphasage entre deux écrans jumeaux pour qu'ils ne soient jamais
  // parfaitement synchronisés (plus vivant).
  const tOff = t + (screen.phase || 0) * 900;

  if (screen.shape === 'circle') {
    const { cx, cy, r } = screen;

    ctx.save();
    ctx.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${glowAlpha})`;
    ctx.shadowBlur = 24 + pulseEnv * 26;
    ctx.fillStyle = '#0a0810';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const bgGrad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    bgGrad.addColorStop(0, '#050308');
    bgGrad.addColorStop(1, shadeColor(tint, -70));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    drawScreenTunnel(tOff, cx - r, cy - r, r * 2, r * 2, tint, pulseEnv);
    drawScreenOctopus(tOff, cx, cy + r * 0.4, r * 1.7, tint, pulseEnv);

    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let sy = cy - r; sy < cy + r; sy += 4) ctx.fillRect(cx - r, sy, r * 2, 1.4);

    ctx.restore();
    return;
  }

  const { x, y, width, height } = screen;

  // Cadre de l'écran : lueur douce + bordure façon régie technique.
  ctx.save();
  ctx.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${glowAlpha})`;
  ctx.shadowBlur = 30 + pulseEnv * 30;
  ctx.fillStyle = '#0a0810';
  ctx.fillRect(x - 8, y - 8, width + 16, height + 16);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x - 8, y - 8, width + 16, height + 16);
  ctx.restore();

  // Contenu de l'écran, découpé pour ne jamais déborder du cadre.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  const bgGrad = ctx.createLinearGradient(x, y, x, y + height);
  bgGrad.addColorStop(0, '#050308');
  bgGrad.addColorStop(1, shadeColor(tint, -70));
  ctx.fillStyle = bgGrad;
  ctx.fillRect(x, y, width, height);

  drawScreenTunnel(tOff, x, y, width, height, tint, pulseEnv);

  let ocx = x + width / 2;
  if (screen.sweep) {
    // la pieuvre se déplace de gauche à droite sur toute la largeur de l'écran
    // (mainstage arena), aller-retour doux plutôt qu'un simple va-et-vient linéaire.
    const margin = Math.min(width * 0.22, height);
    const span = width - margin * 2;
    const phase = (Math.sin(tOff / 2600) + 1) / 2;
    ocx = x + margin + span * phase;
  }
  drawScreenOctopus(tOff, ocx, y + height * 0.62, height * 0.9, tint, pulseEnv);

  // scanlines discrètes façon écran LED
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let sy = y; sy < y + height; sy += 4) ctx.fillRect(x, sy, width, 1.4);

  ctx.restore();
}

// Grille en perspective + anneaux radiants qui pulsent avec le rythme :
// donne une impression de profondeur/3D à moindre coût sur un simple canvas 2D.
function drawScreenTunnel(t, x, y, width, height, tint, pulseEnv) {
  const cx = x + width / 2, cy = y + height * 0.6;
  const rgb = hexToRgb(tint);

  ctx.save();
  ctx.lineWidth = 1;
  const ringCount = 5;
  for (let i = 0; i < ringCount; i++) {
    const phase = (t / 1400 + i / ringCount) % 1;
    const r = phase * width * 0.62;
    const alpha = (1 - phase) * (0.5 + pulseEnv * 0.5);
    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // grille au sol, lignes convergentes vers le point de fuite (le personnage)
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.22)`;
  const floorY = y + height * 0.98;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + i * width * 0.16, floorY);
    ctx.stroke();
  }
  ctx.restore();
}

// Pieuvre DJ stylisée (remplace l'ancien alien) : mante en dégradé avec
// quelques taches pour une texture de peau moins uniforme, 8 tentacules
// "tapered" avec ventouses qui ondulent chacune avec sa propre phase/fréquence
// (donc dans des directions différentes, jamais toutes synchronisées), et dont
// l'amplitude est amplifiée sur le rythme de la musique (pulseEnv, cf. loop()).
// Grands yeux expressifs + casque DJ posé sur la tête, avec la même lueur de
// contour reprenant la couleur de l'effet lumineux actif que l'ancien décor.
function drawScreenOctopus(t, cx, baseY, scaleH, tint, pulseEnv) {
  const s = scaleH / 300;
  const rgb = hexToRgb(tint);
  const sway = Math.sin(t / 1300) * 9 * s;
  const bob = Math.sin(t / 700) * 6 * s - pulseEnv * 14 * s;
  const bodyColor = '#9c3f6e';
  const kick = 1 + pulseEnv * 1.1; // amplifie l'ondulation des tentacules sur le rythme

  ctx.save();
  ctx.translate(cx + sway, baseY + bob);

  // faisceau lumineux au sol : la pieuvre semble flotter dedans (même traitement que l'ancien décor)
  const beamGrad = ctx.createLinearGradient(0, -10 * s, 0, 90 * s);
  beamGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.32)`);
  beamGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(-34 * s, 90 * s);
  ctx.lineTo(34 * s, 90 * s);
  ctx.lineTo(12 * s, -10 * s);
  ctx.lineTo(-12 * s, -10 * s);
  ctx.closePath();
  ctx.fill();

  // ombre portée douce au sol
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 88 * s, 30 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const mantleCY = -42 * s, mantleR = 40 * s;

  // --- tentacules, dessinées avant la mante pour qu'elles semblent en sortir ---
  function drawTentacle(angle, len, width0, phase, freqMul) {
    const N = 9;
    const originX = Math.cos(angle) * mantleR * 0.5;
    const originY = mantleCY + Math.sin(angle) * mantleR * 0.5 + mantleR * 0.4;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const frac = i / N;
      const dist = len * frac;
      const wave = Math.sin(t / (260 / freqMul) + phase + frac * 5.2) * (2 + frac * 15) * kick;
      const curl = Math.sin(t / 1100 + phase * 1.6) * frac * 12;
      const off = wave + curl;
      pts.push([
        originX + Math.cos(angle) * dist - Math.sin(angle) * off,
        originY + Math.sin(angle) * dist + Math.cos(angle) * off
      ]);
    }
    const left = [], right = [];
    for (let i = 0; i <= N; i++) {
      const frac = i / N;
      const w = width0 * (1 - frac * 0.88);
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(N, i + 1)];
      let tx = p1[0] - p0[0], ty = p1[1] - p0[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      left.push([pts[i][0] + nx * w / 2, pts[i][1] + ny * w / 2]);
      right.push([pts[i][0] - nx * w / 2, pts[i][1] - ny * w / 2]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    const grad = ctx.createLinearGradient(originX, originY, pts[N][0], pts[N][1]);
    grad.addColorStop(0, shadeColor(bodyColor, 12));
    grad.addColorStop(1, shadeColor(bodyColor, -26));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = shadeColor(bodyColor, -45);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // ventouses : chaque cercle dans son propre sous-chemin (jamais deux arcs
    // dans un même chemin sans beginPath entre eux, sinon un trait droit les relie)
    ctx.fillStyle = shadeColor(bodyColor, 30);
    for (let i = 1; i < N; i++) {
      const frac = i / N;
      if (frac > 0.9) continue;
      const r = Math.max(0.9, width0 * 0.15 * (1 - frac * 0.75));
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // éventail sur ~290°, centré vers le bas : les tentacules partent ainsi dans
  // des directions très différentes (bas, côtés, un peu vers le haut) plutôt
  // que toutes vers le bas comme une simple frange.
  const tentacleCount = 8;
  const lens = [78, 92, 68, 100, 74, 96, 70, 88];
  const widths = [15, 13, 16, 12, 15.5, 12.5, 16.5, 13];
  for (let i = 0; i < tentacleCount; i++) {
    const angle = (-55 + 290 * (i / (tentacleCount - 1))) * Math.PI / 180;
    drawTentacle(angle, lens[i] * s, widths[i] * s, i * 1.7, 0.7 + (i % 3) * 0.25);
  }

  // --- mante (tête/corps) ---
  const mantleGrad = ctx.createRadialGradient(-mantleR * 0.35, mantleCY - mantleR * 0.35, mantleR * 0.15, 0, mantleCY, mantleR * 1.2);
  mantleGrad.addColorStop(0, shadeColor(bodyColor, 32));
  mantleGrad.addColorStop(0.55, bodyColor);
  mantleGrad.addColorStop(1, shadeColor(bodyColor, -28));
  ctx.fillStyle = mantleGrad;
  ctx.beginPath();
  ctx.ellipse(0, mantleCY, mantleR, mantleR * 1.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // lueur de contour reprenant la couleur de l'effet lumineux actif (cohérence avec le reste de l'écran)
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.45 + pulseEnv * 0.5})`;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`;
  ctx.shadowBlur = 12 + pulseEnv * 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // taches sur la mante, pour une texture de peau moins uniforme
  const spots = [[-14, -12, 6, 3.4], [10, -20, 5, 2.8], [-4, 6, 7, 3.6], [16, 4, 4.4, 2.4], [-18, 10, 4, 2.2]];
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  spots.forEach(([sx, sy, srx, sry]) => {
    ctx.beginPath();
    ctx.ellipse(sx * s, mantleCY + sy * s, srx * s, sry * s, 0.4, 0, Math.PI * 2);
    ctx.fill();
  });

  // --- yeux, grands et expressifs ---
  [-1, 1].forEach(side => {
    ctx.save();
    ctx.translate(side * 15 * s, mantleCY - 6 * s);
    ctx.fillStyle = '#f4ede2';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10 * s, 11 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, '#f4ede2', 1.4);
    ctx.fillStyle = '#17121e';
    ctx.beginPath();
    ctx.ellipse(side * 1.5 * s, 1 * s, 5.6 * s, 6.4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.7 + pulseEnv * 0.3})`;
    ctx.beginPath();
    ctx.arc(side * 3 * s, -1.5 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // petit bec, sous les yeux (détail de céphalopode)
  ctx.fillStyle = '#241c30';
  ctx.beginPath();
  ctx.moveTo(-4 * s, mantleCY + 10 * s);
  ctx.lineTo(4 * s, mantleCY + 10 * s);
  ctx.lineTo(0, mantleCY + 15 * s);
  ctx.closePath();
  ctx.fill();

  // --- casque DJ, posé sur la mante ---
  ctx.strokeStyle = '#1c1a24';
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.arc(0, mantleCY - 2 * s, mantleR * 1.02, Math.PI * 1.18, Math.PI * 1.82);
  ctx.stroke();
  [-1, 1].forEach(side => {
    const ex = side * mantleR * 0.92, ey = mantleCY + mantleR * 0.1;
    ctx.fillStyle = '#1c1a24';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 9 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, '#1c1a24', 1.6);
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.6 + pulseEnv * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 4.4 * s, 6.4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

