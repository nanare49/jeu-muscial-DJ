// 24-dj-character.js
// Rendu du DJ sur scène (tête selon l'avatar choisi, corps, platines).
// Le DJ est dessiné à un emplacement fixe sur la scène (pas dans la foule),
// de face, avec les platines, selon la position qu'il a choisie.
// Dessine la tête du DJ selon le type d'avatar choisi à l'entrée (l'humain
// garde en plus le casque DJ classique autour des oreilles).
function drawDjHead(ctx, avatarType, color, skinTone) {
  if (avatarType === 'robot') {
    ctx.fillStyle = '#3a3a44';
    roundRect(ctx, -13, -34, 26, 22, 7);
    ctx.fill();
    strokeOutline(ctx, '#3a3a44', 2.2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -34); ctx.lineTo(0, -42);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -44, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, color, 1.8);
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.arc(0, -22, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (avatarType === 'alien') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, -24, 14, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, color, 2.2);
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.ellipse(-6, -25, 4.5, 6.5, -0.2, 0, Math.PI * 2);
    ctx.ellipse(6, -25, 4.5, 6.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (avatarType === 'ghost') {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -22, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    strokeOutline(ctx, color, 2.2);
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.arc(-5, -23, 2.2, 0, Math.PI * 2);
    ctx.arc(5, -23, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (avatarType === 'dragon') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -22, 13, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, color, 2.2);
    ctx.fillStyle = '#e9e4f2';
    ctx.beginPath();
    ctx.moveTo(-6, -32); ctx.lineTo(-3, -40); ctx.lineTo(-1, -32); ctx.closePath();
    ctx.fill();
    strokeOutline(ctx, '#e9e4f2', 1.6);
    ctx.beginPath();
    ctx.moveTo(6, -32); ctx.lineTo(3, -40); ctx.lineTo(1, -32); ctx.closePath();
    ctx.fill();
    strokeOutline(ctx, '#e9e4f2', 1.6);
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.arc(-4, -23, 2, 0, Math.PI * 2);
    ctx.arc(4, -23, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (avatarType === 'blob') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -20, 13, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, color, 2.2);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, -20, 6, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, '#fff', 1.6);
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.arc(0, -20, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // humain, avec le casque DJ classique
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.arc(0, -22, 14, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, skinTone, 2.2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -22, 15, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-14, -18, 4, 0, Math.PI * 2);
    ctx.arc(14, -18, 4, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, color, 1.6);
    ctx.fillStyle = '#2a2136';
    ctx.beginPath();
    ctx.arc(-6, -22, 1.6, 0, Math.PI * 2);
    ctx.arc(6, -22, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDjOnStage(p, isMe, t) {
  const cx = W / 2, cy = stageCenterY();
  const scale = 1.15;
  const color = p.avatarColor || p.color || '#ff5fa3';
  const pose = p.pose || 'dj_behind';
  const accessory = p.accessory || 'none';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  let rawArmLift = 0, rawBob = 0, rawSway = 0;
  if (pose === 'dj_behind') { rawBob = Math.sin(t / 500) * 2; rawSway = Math.sin(t / 700) * 2; }
  else if (pose === 'dj_behind_hands') { rawArmLift = 1; rawBob = Math.abs(Math.sin(t / 220)) * 10; }
  else if (pose === 'dj_on_deck') { rawArmLift = 0.6 + Math.sin(t / 180) * 0.4; rawBob = Math.abs(Math.sin(t / 180)) * 16; }
  else if (pose === 'dj_front_dance') { rawSway = Math.sin(t / 300) * 14; rawArmLift = 0.3 + Math.sin(t / 300) * 0.3; rawBob = Math.abs(Math.sin(t / 300)) * 4; }
  else if (pose === 'dj_front_cannon') { rawArmLift = 0.85; rawBob = Math.sin(t / 260) * 2; }

  let rawDjY = -20; // derrière les platines par défaut
  if (pose === 'dj_on_deck') rawDjY = -38;
  else if (pose === 'dj_front_dance' || pose === 'dj_front_cannon') rawDjY = 34;

  if (!p._motion) p._motion = {};
  const { armLift, bob, sway, djY } = smoothMotion(p._motion, { armLift: rawArmLift, bob: rawBob, sway: rawSway, djY: rawDjY }, t);

  const drawDeckFirst = pose !== 'dj_front_dance' && pose !== 'dj_front_cannon';

  function drawDeckProp() {
    ctx.fillStyle = '#2a2140';
    roundRect(ctx, -70, -25, 140, 50, 10);
    ctx.fill();
    ctx.fillStyle = '#1a1526';
    ctx.beginPath();
    ctx.arc(-32, 0, 15, 0, Math.PI * 2);
    ctx.arc(32, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-32, 0, 3.5, 0, Math.PI * 2);
    ctx.arc(32, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDjFigure() {
    ctx.save();
    ctx.translate(sway, djY - bob);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 44, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const skinTone = '#f0cca3';
    const armAngleLow = 0.35, armAngleHigh = Math.PI / 2 + 0.3;
    const angle = armAngleLow + (armAngleHigh - armAngleLow) * armLift;
    const armLen = 22, shoulderY = -6;
    const lx = -14 - Math.cos(angle) * armLen, ly = shoulderY - Math.sin(angle) * armLen;
    const rx = 14 + Math.cos(angle) * armLen, ry = shoulderY - Math.sin(angle) * armLen;

    // bras (dessinés avant le torse pour passer dessous à l'épaule)
    drawLimbTube(ctx, -14, shoulderY, lx, ly, 9, color);
    drawLimbTube(ctx, 14, shoulderY, rx, ry, 9, color);

    // corps
    ctx.fillStyle = linearBodyGradient(ctx, -15, -12, 30, 32, color);
    roundRect(ctx, -15, -12, 30, 32, 10);
    ctx.fill();
    strokeOutline(ctx, color, 2.4);
    drawFlatHighlight(ctx, -5, -4, 6, 10, 0.14);

    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, skinTone, 1.8);

    // canon à cotillons, tenu entre les mains levées
    if (pose === 'dj_front_cannon') {
      const cannonY = shoulderY - Math.sin(angle) * armLen - 4;
      ctx.fillStyle = '#463a63';
      roundRect(ctx, -8, cannonY - 8, 16, 22, 5);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-8, cannonY - 8);
      ctx.lineTo(8, cannonY - 8);
      ctx.lineTo(0, cannonY - 18);
      ctx.closePath();
      ctx.fill();
    }

    // tête, selon le type d'avatar choisi (+ casque DJ pour l'humain)
    drawDjHead(ctx, p.avatarType, color, skinTone);

    if (accessory === 'cap') {
      ctx.fillStyle = '#2f9e6b';
      ctx.beginPath();
      ctx.arc(0, -23, 14.5, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
      strokeOutline(ctx, '#2f9e6b', 1.8);
    } else if (accessory === 'hat') {
      ctx.fillStyle = '#caa25a';
      ctx.beginPath();
      ctx.ellipse(0, -30, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      strokeOutline(ctx, '#caa25a', 1.8);
    }
    drawPremiumAccessory(ctx, accessory, -22, 17);

    if (isMe) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -22, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  if (drawDeckFirst) { drawDjFigure(); drawDeckProp(); }
  else { drawDeckProp(); drawDjFigure(); }

  ctx.restore();

  ctx.fillStyle = '#e9e4f2';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🎧 ' + (p.name || ''), cx, cy - 100 * scale);
}

