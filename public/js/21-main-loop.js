// 21-main-loop.js
// La boucle de rendu principale (loop()) : c'est elle qui appelle, à chaque frame, toutes les fonctions de dessin définies dans les autres fichiers.
// Fait vibrer légèrement toute la scène (piste + joueurs) en rythme, et
// l'assombrit doucement entre les temps : la piste "respire" avec la
// musique, plus sombre juste avant chaque battement, plus claire pile dessus.
function drawMusicPulseOverlay(beat, env) {
  if (beat === null) return;
  const alpha = 0.24 * (1 - env);
  if (alpha <= 0.01) return;
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

function loop(t) {
  ctx.clearRect(0, 0, W, H);
  // Le rythme automatique (vibration + assombrissement) ne joue que si le DJ
  // a choisi de suivre la musique automatiquement ; en mode manuel, seul un
  // tremblement explicitement déclenché par le DJ fait bouger la piste, et
  // l'assombrissement reste éteint (pas demandé en mode manuel).
  const autoOn = !!(currentLightEffects && currentLightEffects.autoMode);
  // La structure métallique (truss, cf. drawTrussLights/currentMusicSection)
  // reste réactive au son en continu, même si le DJ n'a pas activé "suivre la
  // musique automatiquement" (ce mode auto ne concerne que SES effets à lui) :
  // on garde donc l'énergie réelle ET la détection de séquence (vjState —
  // couplet/montée/drop) toujours à jour dès qu'un fichier importé joue,
  // indépendamment de autoOn.
  if (isRealAudioActive()) {
    updateRealMusicEnergy();
    updateReactiveAutoVJ(t);
  }
  let beat = null, autoEnv = 0;
  if (autoOn && isRealAudioActive()) {
    // fichier importé : vraie analyse du son (cf. updateRealMusicEnergy) au lieu
    // du rythme simulé — `beat` ne sert plus ici qu'à signaler "une musique
    // tourne" à drawMusicPulseOverlay, l'intensité vient directement du son réel.
    autoEnv = realMusicEnergy;
    beat = 1 - autoEnv;
  } else if (autoOn) {
    beat = beatPhase();
    autoEnv = beat !== null ? Math.pow(1 - beat, 3) : 0; // pic net au battement, retombe vite
  }

  let shakeEnv = autoEnv;
  if (manualShake) {
    const elapsed = serverNow() - manualShake.startAt;
    const total = manualShake.repeatCount * manualShake.periodMs;
    if (elapsed >= 0 && elapsed < total) {
      const phase = (elapsed % manualShake.periodMs) / manualShake.periodMs;
      shakeEnv = Math.max(shakeEnv, manualShake.intensity * Math.pow(1 - phase, 3));
    } else if (elapsed >= total) {
      manualShake = null;
    }
  }

  ctx.save();
  if (shakeEnv > 0) {
    const jx = Math.sin(t / 17) * shakeEnv * 3;
    const jy = Math.cos(t / 23) * shakeEnv * 2;
    ctx.translate(jx, jy);
  }
  drawBackground(t, shakeEnv);
  drawTrussLights(t, shakeEnv);
  drawLightEffectsBackground(t);
  drawDiscoTiles(t);
  drawRoundItems(t);
  // Le DJ n'est plus figé sur une estrade avec une illustration à part : qu'on
  // soit DJ ou invité, on est sur la piste, avec le même personnage animé, et on
  // peut se déplacer normalement (cf. updateMovement).
  Object.entries(players).forEach(([id, p]) => {
    drawPlayer(p, id === selfId, t);
  });
  ctx.restore();
  drawAmbientRoomLighting(t);
  drawMusicPulseOverlay(beat, autoEnv);
  updateAndDrawConfetti();
  drawFlashEffect(t);
  activeBubbles.forEach(positionBubble);
  updateTrackTimingUI(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

