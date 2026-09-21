// 28-reactive-auto-vj.js
// Régie automatique réellement pilotée par le son : détection de séquence (calme/couplet/montée/drop) et effets lumineux qui en découlent.
// --- régie automatique VRAIMENT pilotée par le son -----------------------------
// Tant qu'un fichier importé joue et que le mode auto est actif, on calcule ici
// localement (chaque navigateur analyse son propre son, en phase puisque la
// lecture est synchronisée entre tous, cf. currentActualPosition) un état de
// régie complet — quels effets sont allumés, à quelle puissance/vitesse, avec
// quelle couleur — à la place de l'ancien tirage aléatoire du serveur toutes les
// 2,5 à 5 secondes (cf. scheduleAutoLightsTick, désormais réservé au fallback
// YouTube où le son réel n'est pas analysable). Ce résultat est lu par
// getEffectiveLightEffects() pour l'affichage uniquement : il ne remplace
// jamais l'état serveur (currentLightEffects), qui reste ce que les contrôles
// du DJ affichent et envoient.
const AUTO_VJ_COLORS = ['#ff5fa3', '#5ad1ff', '#ffd35a', '#4ade80', '#c084fc', '#ff8c3d', '#33e6e6', '#ff4d6d'];
// Palette de couleurs par séquence : la couleur ne se contente plus de
// changer à chaque kick au hasard dans la même liste, elle suit vraiment
// l'ambiance de la séquence — plus froid/posé en couplet, plus chaud à
// l'approche du drop, franc et éclatant (quasi blanc) pendant le drop lui-même.
const SECTION_COLOR_POOLS = {
  calm: ['#5ad1ff', '#7c9bff', '#33e6e6', '#8a7bff'],
  normal: AUTO_VJ_COLORS,
  buildup: ['#ffd35a', '#ff8c3d', '#ff5fa3', '#ffb84d'],
  drop: ['#ffffff', '#ff4d6d', '#ff5fa3', '#5ad1ff', '#4ade80'],
};
// Formats de laser tirés au sort pour le "drop" (effet fort mais varié d'un
// drop à l'autre — burst/flash en plus, pour une vraie rafale façon plusieurs
// lasers qui claquent d'un coup) et pour l'ambiance "normale" (moins
// spectaculaires).
const DROP_LASER_STYLES = ['burst', 'flash', 'fan', 'converge', 'chase', 'cross'];
const NORMAL_LASER_STYLES = ['rotating', 'sweep'];
let vjDropLaserStyle = 'fan';
let vjNormalLaserStyle = 'rotating';
let vjNormalStyleSince = 0;
let vjState = 'calm';        // 'calm' | 'normal' | 'buildup' | 'drop'
let vjStateSince = 0;
let vjDropUntil = 0;
let vjCooldownUntil = 0;     // empêche de ré-enchaîner un buildup juste après un drop
let vjEmaShort = 0, vjEmaLong = 0;
let vjColor = AUTO_VJ_COLORS[0];
let vjColorKickSeen = 0;     // dernier lastKickAt pris en compte pour changer de couleur
let vjLaserPhase = 0;
let vjLastFrameAt = null;

function pickAutoVjColor(avoid, pool) {
  const list = pool && pool.length ? pool : AUTO_VJ_COLORS;
  let c = list[Math.floor(Math.random() * list.length)];
  if (c === avoid && list.length > 1) {
    c = list[(list.indexOf(c) + 1) % list.length];
  }
  return c;
}

// Calcule (et met à jour) l'état de régie réactif : à appeler une fois par
// frame, uniquement quand le mode auto est actif et qu'un vrai son est analysé.
function updateReactiveAutoVJ(now) {
  vjLastFrameAt = now;

  // moyennes mobiles rapide/lente de l'énergie grave : une montée nette et
  // soutenue de la rapide au-dessus de la lente ressemble à un "build-up".
  vjEmaShort += (realMusicEnergy - vjEmaShort) * 0.10;
  vjEmaLong += (realMusicEnergy - vjEmaLong) * 0.01;

  const sinceKick = now - lastKickAt;
  const bigKickJustNow = sinceKick < 90 && lastKickStrength > 0.55;

  if (vjState === 'drop') {
    if (now > vjDropUntil) {
      vjState = 'normal';
      vjStateSince = now;
      vjCooldownUntil = now + 4000;
    }
  } else if (vjState === 'buildup') {
    if (bigKickJustNow && vjEmaShort > 0.18 && now > vjCooldownUntil) {
      vjState = 'drop';
      vjStateSince = now;
      vjDropUntil = now + 2800;
      // format de laser tiré au sort à chaque nouveau drop, pour varier — "plus
      // de formats différents de laser" plutôt que toujours le même à chaque drop
      vjDropLaserStyle = DROP_LASER_STYLES[Math.floor(Math.random() * DROP_LASER_STYLES.length)];
      // la couleur "claque" pile au moment où le drop démarre (palette franche/
      // éclatante), plutôt que d'attendre le prochain kick pour en changer.
      vjColor = pickAutoVjColor(vjColor, SECTION_COLOR_POOLS.drop);
    } else if (vjEmaShort < vjEmaLong * 0.9) {
      // la montée est retombée sans déclencher de drop : retour au calme
      vjState = 'normal';
      vjStateSince = now;
    }
  } else {
    // 'calm' ou 'normal'
    if (realMusicEnergy < 0.06) {
      vjState = 'calm';
    } else {
      if (vjState === 'calm') { vjState = 'normal'; vjStateSince = now; }
      if (vjEmaShort > vjEmaLong * 1.18 && vjEmaShort > 0.28 && now > vjCooldownUntil) {
        vjState = 'buildup';
        vjStateSince = now;
      }
    }
  }

  // couleur commune à tous les effets, qui change à chaque kick détecté — la
  // palette dans laquelle elle est tirée suit la séquence en cours (cf.
  // SECTION_COLOR_POOLS), donc la couleur "raconte" vraiment où on en est
  // dans le morceau plutôt que de rester un simple tirage indépendant.
  if (lastKickAt !== vjColorKickSeen && lastKickStrength > 0.2) {
    vjColorKickSeen = lastKickAt;
    vjColor = pickAutoVjColor(vjColor, SECTION_COLOR_POOLS[vjState]);
  }

  // le flash plein écran ne redéclenche jamais plus vite que FLASH_MIN_INTERVAL_MS,
  // même si les kicks détectés sont plus rapprochés (sécurité photosensibilité).
  if (lastKickAt !== lastFlashKickAt && now - lastFlashKickAt >= FLASH_MIN_INTERVAL_MS) {
    lastFlashKickAt = lastKickAt;
  }

  // le balayage des lasers avance plus vite quand la mélodie (médiums/aigus)
  // est chargée, et ralentit dans les passages calmes — "les lasers bougent
  // au son de la mélodie" plutôt qu'à vitesse constante.
  vjLaserPhase += 0.0009 + realMidEnergy * 0.006;

  // en dehors des drops, le format de laser change de temps en temps (pas à
  // chaque frame) pour varier un peu sans être non plus incohérent en continu.
  if (vjNormalStyleSince === 0) vjNormalStyleSince = now;
  if (now - vjNormalStyleSince > 14000) {
    vjNormalLaserStyle = NORMAL_LASER_STYLES[Math.floor(Math.random() * NORMAL_LASER_STYLES.length)];
    vjNormalStyleSince = now;
  }
}

// Enveloppe de flash calée sur le dernier kick ayant eu le droit de déclencher
// un flash (cf. FLASH_MIN_INTERVAL_MS ci-dessus, pas juste le dernier kick
// détecté) : pic net puis retombée rapide, utilisée par drawFlashEffect à la
// place du sinus générique quand la régie réactive est active — "des flashs
// en même temps que les kicks", sans dépasser un rythme sûr.
function reactiveKickFlashEnvelope(now) {
  const dt = now - lastFlashKickAt;
  if (dt < 0 || dt > 500) return 0;
  return Math.exp(-dt / 110) * lastKickStrength;
}

// Construit l'état d'effets lumineux à afficher pour l'état de régie réactif
// courant (calme/normal/build-up/drop) : c'est ici que se décide quels effets
// sont allumés et avec quelle intensité, sans les plafonds fixes du mode
// manuel — "pas limité sur la vitesse et l'intensité".
function reactiveLightEffectsFor(state) {
  const base = {
    flash: { on: false, color: vjColor },
    laser: { on: true, color: vjColor, count: 5, style: vjNormalLaserStyle },
    fireballs: { on: false, color: vjColor, count: 4 },
    sparks: { on: false, color: vjColor, count: 6, intensity: 0.5 },
    ledbar: { on: true, color: vjColor },
    smoke: { on: false, color: '#cfd6e6', count: 4 },
    power: 0.55, speed: 1.0,
    autoMode: true
  };
  if (state === 'calm') {
    base.laser.on = false;
    base.ledbar.on = false;
    base.power = 0.2; base.speed = 0.5;
  } else if (state === 'buildup') {
    base.flash.on = true;
    base.sparks.on = true;
    base.sparks.intensity = 0.7;
    base.power = 0.75 + realMusicEnergy * 0.3;
    base.speed = 1.4 + realMusicEnergy * 0.8;
  } else if (state === 'drop') {
    base.flash.on = true;
    base.fireballs.on = true;
    base.sparks.on = true;
    base.sparks.intensity = 1;
    // "en masse" pile sur le drop (jamais en couplet/montée, cf. plus haut) :
    // tous les canons à fumée d'un coup plutôt qu'une poignée.
    base.smoke.on = true;
    base.smoke.count = 7;
    base.laser.count = 8;
    base.laser.style = vjDropLaserStyle;
    // légèrement "en surrégime" (au-delà de 1) pour l'impact du drop, mais
    // nettement moins qu'avant : le flash plein écran a de toute façon son
    // propre plafond de sécurité (cf. FLASH_ALPHA_MAX/FLASH_SAFE_SPEED_MAX),
    // l'essentiel de l'effet "drop" vient d'avoir plusieurs effets à la fois.
    base.power = 0.95 + realMusicEnergy * 0.2;
    base.speed = 2.0 + realMusicEnergy * 0.8;
  } else { // 'normal'
    base.sparks.on = realMusicEnergy > 0.3;
    base.fireballs.on = lastKickStrength > 0.6 && (performance.now() - lastKickAt) < 220;
    base.power = 0.5 + realMusicEnergy * 0.5;
    base.speed = 0.9 + realMidEnergy * 1.2;
  }
  return base;
}

// Point d'entrée unique pour le rendu : renvoie l'état "réel" du serveur
// (contrôles manuels du DJ, ou fallback YouTube aléatoire) SAUF quand le mode
// auto est actif et qu'un vrai fichier audio est analysé, où l'affichage suit
// alors la régie réactive calculée ci-dessus.
function getEffectiveLightEffects() {
  if (currentLightEffects && currentLightEffects.autoMode && isRealAudioActive()) {
    return reactiveLightEffectsFor(vjState);
  }
  return currentLightEffects;
}
