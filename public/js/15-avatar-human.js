// 15-avatar-human.js
// Avatar « Festivalier » (humain), personnalisable (cheveux/haut/bras/jambes/peau).
function drawHumanBody(c, move, accessory, color, isMe, t, motionState, custom) {
  const { armAngle, armLift, bob, sway, legSpread } = smoothMotion(motionState || {}, motionFor(move, t), t);
  c.translate(sway, -bob);
  drawShadow(c, sway, bob);

  const cu = custom || {};
  const hairOpt = HUMAN_HAIR_OPTIONS[clampIndex(cu.hairIndex, HUMAN_HAIR_OPTIONS.length)];
  const shirtOpt = HUMAN_SHIRT_COLORS[clampIndex(cu.shirtIndex, HUMAN_SHIRT_COLORS.length)];
  const sleeveOpt = HUMAN_SLEEVE_OPTIONS[clampIndex(cu.sleeveIndex, HUMAN_SLEEVE_OPTIONS.length)];
  const pantsOpt = HUMAN_PANTS_COLORS[clampIndex(cu.pantsIndex, HUMAN_PANTS_COLORS.length)];
  const skinOpt = HUMAN_SKIN_TINTS[clampIndex(cu.skinIndex, HUMAN_SKIN_TINTS.length)];

  const headImg = getSpriteImage('skin/' + skinOpt.key + '/head.png');
  const neckImg = getSpriteImage('skin/' + skinOpt.key + '/neck.png');
  const hairImg = getSpriteImage('hair/' + hairOpt.hair);
  const faceImg = getSpriteImage('face/' + hairOpt.face);
  const shirtImg = getSpriteImage('shirts/' + shirtOpt.key + '/shirt.png');
  const waistImg = getSpriteImage('pants/' + pantsOpt.key + '/waist.png');
  const legImg = getSpriteImage('pants/' + pantsOpt.key + '/leg_long.png');
  const shoeImg = getSpriteImage('shoes/default.png');

  // repère "sprite" (pixels natifs Kenney) -> repère du jeu : un seul facteur
  // d'échelle S, dérivé de la taille du torse (34x38 dans le jeu = 153x174 en sprite).
  const S = 0.22, CX = 210, Y_TORSO_TOP = 130;
  const [shw, shh] = spriteDims(shirtImg, [153, 174]);
  const Y_HIP = Y_TORSO_TOP + shh - 14;
  const LEG_GAP = 6;
  const [lw, lh] = spriteDims(legImg, [111, 166]);
  const [sw2, sh2] = spriteDims(shoeImg, [94, 42]);
  const [ww, wh] = spriteDims(waistImg, [153, 47]);
  const [nw, nh] = spriteDims(neckImg, [96, 37]);
  const rightLegX = CX + LEG_GAP / 2, leftLegX = CX - LEG_GAP / 2 - lw;
  const shoeY = Y_HIP + lh - sh2 * 0.5;

  // --- bas du corps : jambes, chaussures, ceinture, cou (sous les bras/le haut) ---
  c.save();
  c.translate(-CX * S, -Y_TORSO_TOP * S - 18);
  c.scale(S, S);
  drawSpriteSafe(c, legImg, rightLegX, Y_HIP, lw, lh);
  drawSpriteMirrored(c, legImg, leftLegX, Y_HIP, lw, lh);
  drawSpriteSafe(c, shoeImg, rightLegX + lw * 0.10, shoeY, sw2, sh2);
  drawSpriteMirrored(c, shoeImg, leftLegX + lw * 0.90 - sw2, shoeY, sw2, sh2);
  drawSpriteSafe(c, waistImg, CX - ww / 2, Y_HIP - wh * 0.65, ww, wh);
  drawSpriteSafe(c, neckImg, CX - nw / 2, Y_TORSO_TOP - nh * 0.55, nw, nh);
  c.restore();

  // --- bras (tube coloré, dessinés avant le haut pour passer dessous à l'épaule) ---
  const shoulderY = -10, armLen = 24;
  let lx, ly, rx, ry;
  if (move === 'idle') {
    // Au repos, bras qui pendent bien droit le long du corps (même x que
    // l'épaule, pas d'écartement) : le tube reste alors caché sous le haut sur
    // toute sa hauteur et seule la main dépasse en bas — plus de "trait" visible
    // en travers du ventre comme avec un angle en diagonale.
    lx = -16; rx = 16; ly = ry = shoulderY + 34;
  } else {
    // les autres poses (saut, danse, applaudir...) gardent leur animation d'origine
    const angle = armAngle + (Math.PI / 2 + 0.2 - armAngle) * armLift;
    lx = -16 - Math.cos(angle) * armLen; ly = shoulderY - Math.sin(angle) * armLen;
    rx = 16 + Math.cos(angle) * armLen; ry = shoulderY - Math.sin(angle) * armLen;
  }
  if (move === 'clap') { rx = lx + 6; ry = ly; }
  const skinTone = skinOpt.hex;
  // petit "capuchon" d'épaule (couleur du haut) pour que la manche parte proprement
  // du torse au lieu de commencer par une ligne fine dans le vide
  c.fillStyle = shirtOpt.hex;
  // chaque cercle dans son propre sous-chemin (beginPath séparé) : sinon
  // canvas relie les deux arcs par une ligne droite avant de remplir/contourner,
  // ce qui créait un trait visible entre les deux épaules.
  c.beginPath();
  c.arc(-16, shoulderY, 8, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, shirtOpt.hex, 2);
  c.beginPath();
  c.arc(16, shoulderY, 8, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, shirtOpt.hex, 2);
  drawLimbTubeSleeve(c, -16, shoulderY, lx, ly, 14, shirtOpt.hex, skinTone, sleeveOpt.frac);
  drawLimbTubeSleeve(c, 16, shoulderY, rx, ry, 14, shirtOpt.hex, skinTone, sleeveOpt.frac);

  // --- haut (sprite, recouvre la base des bras à l'épaule) ---
  c.save();
  c.translate(-CX * S, -Y_TORSO_TOP * S - 18);
  c.scale(S, S);
  drawSpriteSafe(c, shirtImg, CX - shw / 2, Y_TORSO_TOP, shw, shh);
  c.restore();

  // motif imprimé sur le haut (note de musique, burger, éclair, manette, "DJ"...)
  if (shirtOpt.icon) {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (shirtOpt.icon === 'DJ') {
      c.font = 'bold 11px sans-serif';
      c.fillStyle = '#241c30';
      c.fillText('DJ', 0, 2);
    } else {
      c.font = '13px sans-serif';
      c.fillText(shirtOpt.icon, 0, 2);
    }
    c.restore();
  }

  if (accessory === 'costume') {
    c.strokeStyle = '#ff5fa3';
    c.lineWidth = 2;
    roundRect(c, -17, -18, 34, 38, 12);
    c.stroke();
  }
  if (accessory === 'buoy') {
    c.strokeStyle = '#ff8a3d';
    c.lineWidth = 10;
    c.beginPath();
    c.ellipse(0, 10, 22, 10, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#ffd08a';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(0, 10, 22, 10, 0, 0.3, 1.2);
    c.ellipse(0, 10, 22, 10, 0, 2.0, 2.9);
    c.stroke();
  }

  // mains (rondes, teint de peau choisi) à l'extrémité des bras.
  // Chaque main dans son propre sous-chemin (beginPath séparé avant chaque
  // arc) : sinon canvas relie automatiquement la fin du premier cercle au
  // début du second par une ligne droite avant remplissage/contour, ce qui
  // produisait le trait visible entre les deux mains.
  c.fillStyle = skinTone;
  c.beginPath();
  c.arc(lx, ly, 7.5, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, skinTone, 2);
  c.beginPath();
  c.arc(rx, ry, 7.5, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, skinTone, 2);

  // --- tête : peau + visage + coiffure (par-dessus mains/haut) ---
  c.save();
  c.translate(-CX * S, -Y_TORSO_TOP * S - 18);
  c.scale(S, S);
  const [hdw, hdh] = spriteDims(headImg, [173, 168]);
  const neckTopY = Y_TORSO_TOP - nh * 0.55;
  const headBottomY = neckTopY + nh * 0.4;
  const headTopY = headBottomY - hdh;
  drawSpriteSafe(c, headImg, CX - hdw / 2, headTopY, hdw, hdh);
  const [fw, fh] = spriteDims(faceImg, [100, 101]);
  drawSpriteSafe(c, faceImg, CX - fw / 2, headTopY + hdh * 0.40, fw, fh);
  const [hrw, hrh] = spriteDims(hairImg, [150, 120]);
  drawSpriteSafe(c, hairImg, CX - hrw / 2, headTopY - hrh * 0.12, hrw, hrh);
  c.restore();

  if (accessory === 'cap') {
    c.fillStyle = '#2f9e6b';
    c.beginPath();
    c.arc(0, -35, 18.2, Math.PI * 0.85, Math.PI * 2.15);
    c.fill();
    strokeOutline(c, '#2f9e6b', 2);
    c.fillRect(-6, -19, 12, 5);
  } else if (accessory === 'hat') {
    c.fillStyle = '#caa25a';
    c.beginPath();
    c.ellipse(0, -40, 25, 6, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 2);
    c.beginPath();
    c.arc(0, -47, 12, Math.PI, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 2);
  }
  drawPremiumAccessory(c, accessory, -32, 17);
}

