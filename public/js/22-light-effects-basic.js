// 22-light-effects-basic.js
// Rendu des effets lumineux activables par le DJ : laser, spots LED de barrière, boules de feu, étincelles, fumée/CO2.
// --- rendu des effets lumineux ---
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 95, b: 163 };
}

function drawLightEffectsBackground(t) {
  const le = getEffectiveLightEffects();
  if (!le) return;
  if (le.laser.on) drawLaserEffect(t, le.power, le.speed, le.laser);
  drawLedBarEffect(t, le.power, le.speed, le.ledbar);
  if (le.fireballs.on) drawFireballsEffect(t, le.power, le.speed, le.fireballs);
  if (le.sparks.on) drawSparksEffect(t, le.power, le.speed, le.sparks);
  if (le.smoke && le.smoke.on) drawSmokeCannonEffect(t, le.power, le.speed, le.smoke);
}

// Plusieurs points de départ de laser répartis sur la scène (comme une rangée
// de lyres motorisées), chacun tirant son propre faisceau. Quand la régie
// réactive pilote l'affichage (fichier importé + mode auto), le balayage suit
// `vjLaserPhase` — qui avance plus ou moins vite selon l'énergie de la mélodie
// (cf. updateReactiveAutoVJ) — plutôt qu'une vitesse constante liée à `t`.
function drawLaserEffect(t, power, speed, laser) {
  const originY = H * 0.045; // départ bien plus haut, façon vraie lyre montée en hauteur
  const sourceCount = laser.count || 4;
  const len = H * 1.15;
  const alphaHex = Math.round(80 + Math.min(1, power) * 175).toString(16).padStart(2, '0');
  const reactive = !!(currentLightEffects && currentLightEffects.autoMode && isRealAudioActive());

  for (let i = 0; i < sourceCount; i++) {
    const originX = W * ((i + 1) / (sourceCount + 1));

    let angle;
    let beamAlphaMul = 1;
    if (laser.style === 'fan') {
      // chaque source ouvre/ferme son éventail en rythme, légèrement décalée entre sources
      const spread = 0.9;
      const base = reactive ? vjLaserPhase * 1.35 : (t / 900) * speed;
      angle = Math.PI / 2 + Math.sin(base + i * 0.6) * spread;
    } else if (laser.style === 'cross') {
      // une source sur deux tourne dans le sens opposé : les faisceaux se croisent
      const dir = i % 2 === 0 ? 1 : -1;
      const base = reactive ? vjLaserPhase * 1.6 * dir : (t / 700) * speed * dir;
      angle = Math.PI / 2 + Math.sin(base + i) * 0.9;
    } else if (laser.style === 'sweep') {
      // toutes les sources balaient EN MÊME TEMPS, parallèles : effet "mur" de
      // faisceaux qui balaie la scène d'un bloc, plutôt que déphasées entre elles.
      const base = reactive ? vjLaserPhase * 1.1 : (t / 1300) * speed;
      angle = Math.PI / 2 + Math.sin(base) * 0.85;
    } else if (laser.style === 'converge') {
      // tous les faisceaux pointent vers un même point mobile au sol : effet
      // "entonnoir" qui s'ouvre et se referme, façon final de concert.
      const base = reactive ? vjLaserPhase * 1.2 : (t / 1200) * speed;
      const targetX = W / 2 + Math.sin(base) * W * 0.32;
      const targetY = originY + len * 0.62;
      angle = Math.atan2(targetY - originY, targetX - originX);
    } else if (laser.style === 'chase') {
      // une seule source (parfois deux) pleinement allumée à la fois, qui se
      // déplace le long de la rangée façon chenillard/poursuite lumineuse.
      const base = reactive ? vjLaserPhase * 2.2 : (t / 260) * speed;
      const activePos = base % sourceCount;
      let dist = Math.abs(i - activePos);
      dist = Math.min(dist, sourceCount - dist);
      beamAlphaMul = Math.max(0, 1 - dist * 0.85);
      angle = Math.PI / 2 + Math.sin(i * 2.1) * 0.5; // angles fixes par source, juste la luminosité chenille
    } else if (laser.style === 'burst') {
      // "Plusieurs lasers au départ" : toutes les sources s'allument ENSEMBLE
      // en rafale, dans un éventail fixe et symétrique, plutôt que déphasées
      // les unes des autres comme les autres styles — façon salve de lasers
      // façon "blinder" de concert, très marquée sur un drop.
      angle = Math.PI / 2 + (i - (sourceCount - 1) / 2) * (1.4 / Math.max(1, sourceCount - 1));
      const base = reactive ? vjLaserPhase * 2.6 : (t / 420) * speed;
      const pulse = (Math.sin(base) + 1) / 2; // même phase pour toutes les sources -> vraie salve synchronisée
      beamAlphaMul = Math.pow(pulse, 2.2); // montée/descente toujours douces, jamais de coupure nette
    } else if (laser.style === 'flash') {
      // "Effet flash" : toutes les sources clignotent à l'unisson façon flash,
      // mais bridé comme le reste du jeu — jamais plus de ~2-3 pics par
      // seconde et toujours une vraie courbe progressive, jamais un aplat net
      // (cf. STROBE_HALF_PERIOD_MS/FLASH_ALPHA_MAX plus bas dans le fichier).
      angle = Math.PI / 2 + Math.sin(i * 2.1) * 0.6;
      const periodMs = 430 / Math.max(0.4, speed);
      const base = reactive ? vjLaserPhase * 3.2 : (t / periodMs);
      const cyc = (Math.sin(base * Math.PI * 2) + 1) / 2;
      beamAlphaMul = Math.pow(cyc, 6); // pic bref mais progressif, jamais un vrai on/off
    } else {
      // balayage rotatif, chaque source déphasée pour ne pas pointer toutes pareil
      const base = reactive ? vjLaserPhase : (t / 1100) * speed;
      angle = Math.PI / 2 + Math.sin(base + i * 1.4) * 1.0;
    }

    if (beamAlphaMul < 0.03) continue;
    const x2 = originX + Math.cos(angle) * len * 0.5;
    const y2 = originY + Math.sin(angle) * len * 0.5 + len * 0.35;
    const grad = ctx.createLinearGradient(originX, originY, x2, y2);
    grad.addColorStop(0, `${laser.color}${alphaHex}`);
    grad.addColorStop(1, `${laser.color}00`);
    ctx.save();
    ctx.globalAlpha = beamAlphaMul;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2 + power * 2.5;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // petit point lumineux à la source, comme un vrai projecteur
    ctx.fillStyle = laser.color;
    ctx.beginPath();
    ctx.arc(originX, originY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Rangée de 30 spots LED rectangulaires alignés juste au-dessus de la barrière du
// public, sur toute la largeur (même niveau que la scène) : toujours visibles (boîtier
// gris/noir même éteints, comme du vrai matériel), et une vague de luminosité colorée
// balaie la rangée quand ils sont allumés, en rythme avec la musique (comme les autres
// effets lumineux).
function drawLedBarEffect(t, power, speed, ledbar) {
  const on = !!(ledbar && ledbar.on);
  const rgb = hexToRgb((ledbar && ledbar.color) || '#ff5fa3');
  const { topY: fenceTopY } = crowdBarrierBounds();
  const y = fenceTopY - 15;
  const count = 30;
  const marginX = Math.max(10, W * 0.015);
  const usableW = W - marginX * 2;
  const gap = usableW / (count - 1);
  const fixtureW = Math.min(22, gap * 0.62);
  const fixtureH = 9;
  const reactive = !!(currentLightEffects && currentLightEffects.autoMode && isRealAudioActive());

  for (let i = 0; i < count; i++) {
    const x = marginX + i * gap;
    const base = reactive ? vjLaserPhase * 1.8 : (t / 700) * speed;
    const wave = (Math.sin(base - i * 0.35) + 1) / 2;
    const intensity = on ? Math.max(0.18, wave) * power : 0;

    ctx.save();
    // boîtier du spot : toujours visible, gris/noir, même quand le spot est éteint
    ctx.fillStyle = '#15131c';
    roundRect(ctx, x - fixtureW / 2 - 2, y - fixtureH / 2 - 2, fixtureW + 4, fixtureH + 4, 2);
    ctx.fill();

    if (on) {
      // halo diffus
      const glow = ctx.createRadialGradient(x, y, 0, x, y, fixtureW * 1.6);
      glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.5 * intensity})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, fixtureW * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // face lumineuse rectangulaire du spot
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.55 + 0.45 * intensity})`;
      roundRect(ctx, x - fixtureW / 2, y - fixtureH / 2, fixtureW, fixtureH, 1.5);
      ctx.fill();
    } else {
      // spot éteint : face grise/noire mate, bien visible sur la scène
      ctx.fillStyle = '#3a3a42';
      roundRect(ctx, x - fixtureW / 2, y - fixtureH / 2, fixtureW, fixtureH, 1.5);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Silhouette d'une flamme (deux lobes qui s'entortillent vers une pointe), tracée
// dans le chemin courant — sert à la fois pour la flamme extérieure et pour le
// cœur intérieur plus clair, dessiné par-dessus en plus petit.
function traceFlameShape(cx, baseY, w, h) {
  ctx.moveTo(cx, baseY);
  ctx.bezierCurveTo(cx - w * 0.52, baseY - h * 0.12, cx - w * 0.58, baseY - h * 0.5, cx - w * 0.16, baseY - h * 0.6);
  ctx.bezierCurveTo(cx - w * 0.32, baseY - h * 0.76, cx - w * 0.10, baseY - h * 0.95, cx + w * 0.04, baseY - h);
  ctx.bezierCurveTo(cx + w * 0.20, baseY - h * 0.84, cx + w * 0.34, baseY - h * 0.68, cx + w * 0.20, baseY - h * 0.52);
  ctx.bezierCurveTo(cx + w * 0.46, baseY - h * 0.42, cx + w * 0.52, baseY - h * 0.16, cx + w * 0.26, baseY - h * 0.04);
  ctx.bezierCurveTo(cx + w * 0.14, baseY + h * 0.02, cx - w * 0.14, baseY + h * 0.02, cx, baseY);
  ctx.closePath();
}

// Rangée de torches à flammes juste derrière la barrière du public (jamais devant,
// jamais au milieu des festivaliers) : 2, 4, 6 ou 8 flammes réparties sur toute la
// largeur, avec une vraie silhouette de flamme (cf. photo de référence) plutôt
// qu'un nuage flou.
function drawFireballsEffect(t, power, speed, fireballs) {
  const rgb = hexToRgb(fireballs.color);
  const count = [2, 4, 6, 8].includes(fireballs.count) ? fireballs.count : 2;
  const { topY: fenceTopY } = crowdBarrierBounds();
  const baseY = fenceTopY + 4; // la base des flammes plonge légèrement derrière la lisse haute
  const spread = Math.min(W * 0.7, 720);

  for (let i = 0; i < count; i++) {
    const seed = i * 12.9;
    const x = count === 1 ? W / 2 : W / 2 + (i / (count - 1) - 0.5) * spread;
    const cycle = (Math.sin((t / 500) * speed + seed) + 1) / 2;
    const intensity = (0.4 + 0.6 * Math.pow(cycle, 2)) * power;
    if (intensity < 0.03) continue;

    const flicker = Math.sin(t / 110 + seed) * 3;
    const h = 44 + intensity * 60;
    const w = 26 + intensity * 12;
    const cx = x + flicker;

    ctx.save();

    // lueur douce projetée derrière la flamme, contre la barrière
    const glow = ctx.createRadialGradient(x, baseY - h * 0.25, 0, x, baseY - h * 0.25, h * 0.95);
    glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.32 * intensity})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, baseY - h * 0.25, h * 0.95, 0, Math.PI * 2);
    ctx.fill();

    // flamme principale (rouge sombre à la base, couleur choisie au milieu, pointe claire)
    ctx.beginPath();
    traceFlameShape(cx, baseY, w, h);
    const outerGrad = ctx.createLinearGradient(cx, baseY, cx, baseY - h);
    outerGrad.addColorStop(0, `rgba(150,20,20,${0.9 * intensity})`);
    outerGrad.addColorStop(0.55, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.92 * intensity})`);
    outerGrad.addColorStop(1, `rgba(255,214,120,${0.85 * intensity})`);
    ctx.fillStyle = outerGrad;
    ctx.fill();

    // cœur intérieur, plus petit et plus clair : effet "flamme dans la flamme"
    ctx.beginPath();
    traceFlameShape(cx + flicker * 0.3, baseY - h * 0.02, w * 0.52, h * 0.62);
    const innerGrad = ctx.createLinearGradient(cx, baseY, cx, baseY - h * 0.62);
    innerGrad.addColorStop(0, `rgba(255,150,50,${0.85 * intensity})`);
    innerGrad.addColorStop(1, `rgba(255,244,200,${0.9 * intensity})`);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    ctx.restore();
  }
}

// Plusieurs fontaines à étincelles, réparties près du DJ, avec une vraie
// trajectoire de jaillissement (montée puis retombée sous la gravité).
function drawSparksEffect(t, power, speed, sparks) {
  const rgb = hexToRgb(sparks.color);
  const fountainCount = sparks.count || 4;
  const intensity = sparks.intensity != null ? sparks.intensity : 0.6;
  const originY = H * 0.5; // juste devant/en dessous du DJ, plus proche que la version précédente
  const spread = 340; // largeur totale sur laquelle les fontaines sont réparties

  for (let f = 0; f < fountainCount; f++) {
    const originX = W / 2 + (f / Math.max(1, fountainCount - 1) - 0.5) * spread;
    const particlesPerFountain = Math.round(14 + intensity * 30);
    const gravity = 900;
    const jetHeight = 180 + intensity * 320; // beaucoup plus haut qu'avant

    for (let i = 0; i < particlesPerFountain; i++) {
      const seed = f * 971.3 + i * 53.7;
      const cycleDuration = 1.0 / Math.max(0.3, speed);
      const tau = (((t / 1000) * speed + seed) % cycleDuration);
      const angle = Math.PI / 2 + Math.sin(seed) * 0.35;
      const v0 = Math.sqrt(2 * gravity * jetHeight) * (0.7 + (seed % 100) / 300);
      const vx = Math.cos(angle) * v0 * 0.4;
      const vy = -Math.sin(angle) * v0;

      const x = originX + vx * tau;
      const y = originY + vy * tau + 0.5 * gravity * tau * tau;
      if (y > originY + 8) continue;

      const life = 1 - tau / cycleDuration;
      const size = (1.5 + life * 2) * (0.7 + intensity * 0.6);
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.max(0, life) * power})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // petit tube d'où jaillit chaque fontaine
    ctx.fillStyle = '#2a2438';
    roundRect(ctx, originX - 7, originY, 14, 16, 3);
    ctx.fill();
  }
}

// Nuage de fumée : plusieurs canons répartis devant la scène, un jet qui
// monte et se disperse en s'élargissant (comme une vraie fumée de canon CO2).
// Canons à fumée : jets bien verticaux (peu d'écart latéral, cf. `spread`
// réduit), avec un cœur dense et quasi blanc près de la buse qui ne se
// diffuse qu'en montant (façon vrai jet de CO2 sous pression, pas un simple
// nuage flou) — et beaucoup de bouffées par canon pour un rendu bien épais.
function drawSmokeCannonEffect(t, power, speed, smoke) {
  const rgb = hexToRgb(smoke.color || '#cfd6e6');
  const count = smoke.count || 4;
  const { topY: fenceTopY } = crowdBarrierBounds();
  const baseY = fenceTopY + 6;
  const allPositions = [W * 0.5, W * 0.24, W * 0.76, W * 0.10, W * 0.90, W * 0.38, W * 0.62];
  const originXs = count <= 1 ? [W / 2] : allPositions.slice(0, count);

  originXs.forEach((originX, oi) => {
    const puffsPerCannon = 26;
    for (let i = 0; i < puffsPerCannon; i++) {
      const seed = oi * 37.1 + i * 12.7;
      const cycleDuration = 1.7 / Math.max(0.4, speed);
      const tau = (((t / 1000) * speed + seed) % cycleDuration) / cycleDuration; // 0..1
      const rise = tau * (170 + power * 150);
      // écart latéral volontairement faible : le jet reste bien vertical,
      // il ne fait que s'évaser très légèrement en montant.
      const spread = tau * (11 + power * 13);
      const wobble = Math.sin(seed + tau * 3) * spread;
      const x = originX + wobble;
      const y = baseY - rise;
      const alpha = Math.max(0, Math.pow(1 - tau, 0.65) * 0.85 * Math.min(1.4, power));
      if (alpha < 0.02) continue;
      // taille nettement plus généreuse (jet "épais"), et un cœur quasi blanc
      // très dense tout près de la buse (tau proche de 0), qui laisse place au
      // gris habituel une fois que le jet a commencé à se disperser.
      const size = 22 + tau * 66;
      const coreMix = Math.max(0, 1 - tau * 2.2); // 1 tout près de la buse -> 0 assez vite
      const r = Math.round(rgb.r + (255 - rgb.r) * coreMix);
      const g = Math.round(rgb.g + (255 - rgb.g) * coreMix);
      const b = Math.round(rgb.b + (255 - rgb.b) * coreMix);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.75})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // jet dense et net juste à la sortie de la buse (avant que ça ne
    // commence à se disperser), pour un vrai "coup" de CO2 sous pression.
    const jetH = 26 + power * 18;
    const jetGrad = ctx.createLinearGradient(originX, baseY, originX, baseY - jetH);
    jetGrad.addColorStop(0, `rgba(255,255,255,${0.75 * power})`);
    jetGrad.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = jetGrad;
    ctx.beginPath();
    ctx.ellipse(originX, baseY - jetH * 0.5, 13 + power * 4, jetH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // buse du canon, au sol — plus large et plus "métal", façon vrai canon CO2
    ctx.fillStyle = '#1c1826';
    roundRect(ctx, originX - 13, baseY - 5, 26, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#3a3448';
    roundRect(ctx, originX - 9, baseY - 8, 18, 5, 2);
    ctx.fill();
  });
}

