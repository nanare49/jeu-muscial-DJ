// 23-light-effects-truss-beams.js
// Faisceaux animés de la structure métallique (toujours actifs, réactifs à la musique/séquence), et l'effet flash stroboscopique.
// --- Faisceaux animés de la structure métallique (truss) : toujours présents
// (pas un effet activable/désactivable par le DJ, contrairement à
// drawLightEffectsBackground plus haut — une vraie structure de festival a
// ses lyres/lasers allumés en continu), mais réactifs à la musique via
// pulseEnv comme le reste du décor. Les housings statiques sont dessinés par
// drawTrussStructure (cf. plus haut, dans drawBackground) ; ici uniquement
// les faisceaux/lumière, dessinés par-dessus le reste de la scène (cf. loop).
// Variations toujours en douceur (sinus), jamais de clignotement dur, pour
// rester cohérent avec les contraintes d'accessibilité de tout le jeu
// (cf. STROBE_PEAK_MAX / FLASH_ALPHA_MAX plus bas).
function drawTrussLights(t, pulseEnv) {
  const pos = trussFixturePositions();
  const sec = musicSectionParams();
  const env = Math.max(sec.env, 0.3 + 0.6 * Math.max(0, Math.min(1, pulseEnv || 0)));
  const tempo = sec.tempo;

  pos.movingHeads.forEach(h => drawMovingHeadBeam(h, t, env, tempo));
  pos.lasers.forEach((l, li) => drawTrussLaserProjector(l, t, env, tempo, li));
  drawCo2Bursts(pos.co2, t);
}

// Paramètres par séquence de morceau ('calm'|'normal'|'buildup'|'drop') :
// couplet calme -> lumières lentes et discrètes ; montée -> ça s'accélère ;
// drop -> vitesse et intensité maximales. Mêmes noms de séquence que le
// système de régie réactive existant (vjState, cf. updateReactiveAutoVJ),
// réutilisés ici pour que toute la structure (et pas seulement les effets du
// DJ) suive vraiment l'intensité de chaque séquence, comme demandé.
const MUSIC_SECTION_PARAMS = {
  calm:    { tempo: 0.5, env: 0.22 },
  normal:  { tempo: 1.0, env: 0.5 },
  buildup: { tempo: 1.7, env: 0.8 },
  drop:    { tempo: 2.3, env: 1.0 },
};

// Détecte la séquence de musique en cours et une "énergie" 0..1 associée :
// - fichier importé : vraie détection (vjState, calculée en continu dans
//   loop() via updateReactiveAutoVJ, désormais indépendante du mode auto du
//   DJ — cf. loop()) à partir d'une vraie analyse du son.
// - lien YouTube : impossible d'analyser le son d'une iframe tierce, donc pas
//   de vraie détection couplet/refrain — on approxime quand même build-up et
//   drop à partir du seul repère de structure que le serveur connaît lui
//   aussi : le prochain "drop" programmé (cf. co2BurstStartAt/EndAt, réglés
//   par l'évènement music-drop). Hors de cette fenêtre, on retombe sur
//   'normal' tant qu'un rythme simulé tourne, 'calm' sinon.
function currentMusicSection() {
  if (isRealAudioActive()) return { state: vjState, energy: realMusicEnergy };

  const now = serverNow();
  if (co2BurstEndAt) {
    if (now >= co2BurstStartAt - 2600 && now < co2BurstStartAt) {
      return { state: 'buildup', energy: 1 - (co2BurstStartAt - now) / 2600 };
    }
    if (now >= co2BurstStartAt && now < co2BurstEndAt) {
      return { state: 'drop', energy: 1 };
    }
  }
  return beatPhase() !== null ? { state: 'normal', energy: 0.4 } : { state: 'calm', energy: 0 };
}

// Vitesse (tempo) et intensité (env) à appliquer aux lyres/lasers de la
// structure pour la séquence en cours — l'intensité seule (pulseEnv) n'est
// plus le seul paramètre réactif : la vitesse de balayage suit elle aussi le
// rythme ET change nettement d'une séquence à l'autre (couplet/montée/drop).
function musicSectionParams() {
  const sec = currentMusicSection();
  const p = MUSIC_SECTION_PARAMS[sec.state] || MUSIC_SECTION_PARAMS.normal;
  return {
    tempo: p.tempo + sec.energy * 0.5,
    env: Math.min(1, p.env + sec.energy * 0.25),
    state: sec.state,
  };
}

// Lyre motorisée (beam ou wash) : léger balayage pan/tilt individuel (sinus
// lents, déphasés par lyre pour un effet de vague plutôt que synchronisé), et
// couleur qui varie en continu (cycle de teinte façon roue RGBA/CMYK) —
// jamais deux lyres exactement dans la même phase, comme un vrai show. La
// vitesse de ce balayage (tempo) suit le rythme de la musique en cours.
function drawMovingHeadBeam(h, t, env, tempo) {
  const isWash = h.type === 'wash';
  const tt = t * tempo;
  const hue = (t / 45 + h.seed * 23) % 360;
  const panBase = Math.sin(tt / 2600 + h.seed) * (isWash ? 0.5 : 0.8);
  const tiltPulse = Math.sin(tt / 900 + h.seed * 1.7) * 0.15;
  const angle = Math.PI / 2 + panBase + tiltPulse;
  const flicker = 0.7 + 0.3 * Math.sin(tt / 500 + h.seed * 2.3);
  const alpha = Math.min(1, env * flicker);
  if (alpha < 0.05) return;

  if (isWash) {
    // faisceau large et diffus (flood), façon vraie lyre wash
    const len = H * 0.32;
    const spread = 0.5;
    const a1 = angle - spread / 2, a2 = angle + spread / 2;
    const x1 = h.x + Math.cos(a1) * len, y1 = h.y + Math.sin(a1) * len;
    const x2 = h.x + Math.cos(a2) * len, y2 = h.y + Math.sin(a2) * len;
    const grad = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, len);
    grad.addColorStop(0, `hsla(${hue.toFixed(0)},90%,62%,${0.32 * alpha})`);
    grad.addColorStop(1, `hsla(${hue.toFixed(0)},90%,62%,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  } else {
    // faisceau serré et long (beam), façon vraie lyre beam
    const len = H * 0.62;
    const x2 = h.x + Math.cos(angle) * len;
    const y2 = h.y + Math.sin(angle) * len;
    const grad = ctx.createLinearGradient(h.x, h.y, x2, y2);
    grad.addColorStop(0, `hsla(${hue.toFixed(0)},95%,65%,${0.85 * alpha})`);
    grad.addColorStop(1, `hsla(${hue.toFixed(0)},95%,65%,0)`);
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = `hsla(${hue.toFixed(0)},95%,72%,${alpha})`;
  ctx.beginPath();
  ctx.arc(h.x, h.y, isWash ? 3.4 : 2.6, 0, Math.PI * 2);
  ctx.fill();
}

// Projecteur laser : 10 faisceaux indépendants par projecteur, chacun avec
// son propre cycle d'intensité (montée/descente en douceur, jamais un
// flash net) de sorte que les 10 ne sont jamais tous allumés en même temps —
// couleur, rythme et intensité varient avec la musique (env, dérivé de
// pulseEnv), et la vitesse à laquelle ils s'allument/tournent (tempo) suit
// elle aussi le rythme du morceau, exactement comme demandé.
function drawTrussLaserProjector(l, t, env, tempo, li) {
  const beamCount = 10;
  const len = H * 1.05;
  const tt = t * tempo;
  for (let i = 0; i < beamCount; i++) {
    const seed = l.seed + i * 7.3;
    const cycle = (Math.sin(tt / 640 + seed) + 1) / 2; // 0..1, propre à ce faisceau
    const onAmount = Math.pow(Math.max(0, (cycle - 0.35) / 0.65), 1.4); // montée/descente douces
    const alpha = onAmount * env;
    if (alpha < 0.04) continue;

    const hue = (t / 55 + seed * 31 + li * 180) % 360;
    const spreadAngle = -0.9 + (i / (beamCount - 1)) * 1.8; // éventail des 10 sorties du projecteur
    const wobble = Math.sin(tt / 1400 + seed * 1.9) * 0.12;
    const angle = Math.PI / 2 + spreadAngle * 0.55 + wobble;

    const x2 = l.x + Math.cos(angle) * len;
    const y2 = l.y + Math.sin(angle) * len;
    const grad = ctx.createLinearGradient(l.x, l.y, x2, y2);
    grad.addColorStop(0, `hsla(${hue.toFixed(0)},100%,62%,${0.8 * alpha})`);
    grad.addColorStop(1, `hsla(${hue.toFixed(0)},100%,62%,0)`);
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(l.x, l.y, 2, 0, Math.PI * 2);
  ctx.fill();
}

// Enveloppe (0..1) de la bouffée de CO2 en cours : montée/descente douces sur
// une fenêtre de 4 secondes pile, ancrée sur le prochain/dernier drop reçu
// via l'évènement serveur music-drop (cf. plus haut, co2BurstStartAt/EndAt).
function co2BurstEnvelope() {
  if (!co2BurstEndAt) return 0;
  const now = serverNow();
  if (now < co2BurstStartAt || now > co2BurstEndAt) return 0;
  const dur = co2BurstEndAt - co2BurstStartAt;
  const elapsed = now - co2BurstStartAt;
  const attack = Math.min(1, elapsed / 220);
  const release = Math.min(1, (dur - elapsed) / 260);
  return Math.max(0, Math.min(1, Math.min(attack, release)));
}

// Bouffées de CO2 : déclenchées 4 secondes à chaque drop (moment fort) de la
// musique, tombant depuis les canons montés sur la structure jusqu'au niveau
// de la barrière de sécurité — jamais plus bas, pour ne jamais empiéter sur
// la piste ni gêner le jeu.
function drawCo2Bursts(co2Positions, t) {
  const burst = co2BurstEnvelope();
  if (burst <= 0.01) return;
  const { topY: barrierTopY } = crowdBarrierBounds();
  const rgb = { r: 225, g: 232, b: 245 };

  co2Positions.forEach((c, oi) => {
    const nozzleY = c.y + 14;
    const travel = barrierTopY - nozzleY;
    if (travel <= 0) return;
    // Plus de bouffées, plus grosses, avec un cœur quasi blanc tout près de
    // la buse (façon vrai jet de CO2 sous pression bien épais) qui laisse
    // place au gris habituel une fois que le jet a commencé à se disperser.
    const puffs = 30;
    for (let i = 0; i < puffs; i++) {
      const seed = oi * 41.3 + i * 9.7;
      const tau = (((t / 1000) + seed) % 0.65) / 0.65; // 0..1, jet dense et rapide
      const fall = nozzleY + tau * travel;
      if (fall > barrierTopY) continue; // ne descend jamais sous la barrière (pas sur la piste)
      const wobble = Math.sin(seed + tau * 4) * (8 + tau * 13);
      const x = c.x + wobble;
      const size = 14 + tau * 42;
      const alpha = Math.max(0, 1 - tau * 0.55) * 0.85 * burst;
      if (alpha < 0.03) continue;
      const coreMix = Math.max(0, 1 - tau * 2);
      const r = Math.round(rgb.r + (255 - rgb.r) * coreMix);
      const g = Math.round(rgb.g + (255 - rgb.g) * coreMix);
      const b = Math.round(rgb.b + (255 - rgb.b) * coreMix);
      const grad = ctx.createRadialGradient(x, fall, 0, x, fall, size);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.75})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, fall, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // jet net et dense juste à la sortie de la buse
    const jetH = 30 * burst + 10;
    const jetGrad = ctx.createLinearGradient(c.x, nozzleY, c.x, nozzleY + jetH);
    jetGrad.addColorStop(0, `rgba(255,255,255,${0.85 * burst})`);
    jetGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = jetGrad;
    ctx.beginPath();
    ctx.ellipse(c.x, nozzleY + jetH * 0.5, 9, jetH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.6 * burst})`;
    ctx.beginPath();
    ctx.arc(c.x, nozzleY, 6.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Plafond de luminosité du flash plein écran et vitesse de clignotement bridée
// (cf. `safeSpeed` ci-dessous), quels que soient `power`/`speed` demandés :
// un flash plein écran très lumineux et rapide est un vrai risque pour les
// personnes photosensibles/épileptiques, pas seulement un effet "fort". On
// reste sous ~2,5 flashs/seconde et sous une opacité modérée dans tous les cas.
const FLASH_ALPHA_MAX = 0.32;
const FLASH_SAFE_SPEED_MAX = 1.6;
function drawFlashEffect(t) {
  const le = getEffectiveLightEffects();
  if (!le || !le.flash.on) return;
  const reactive = !!(currentLightEffects && currentLightEffects.autoMode && isRealAudioActive());
  const safeSpeed = Math.min(FLASH_SAFE_SPEED_MAX, le.speed);
  // en régie réactive, le flash est calé sur le dernier kick détecté (pic net
  // puis retombée) plutôt que sur un sinus générique — "des flashs en même
  // temps que les kicks".
  const pulse = reactive
    ? Math.max(Math.pow(Math.max(0, Math.sin((t / 260) * safeSpeed)), 10) * 0.3, reactiveKickFlashEnvelope(performance.now()))
    : Math.pow(Math.max(0, Math.sin((t / 260) * safeSpeed)), 10);
  if (pulse < 0.02) return;
  const rgb = hexToRgb(le.flash.color);
  ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(FLASH_ALPHA_MAX, pulse * le.power * 0.5)})`;
  ctx.fillRect(0, 0, W, H);
}

