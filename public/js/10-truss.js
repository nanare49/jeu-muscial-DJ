// 10-truss.js
// Structure métallique (truss) façon festival : géométrie des lyres/lasers/canons CO2 et leurs boîtiers, commune aux 6 décors.
// --- Structure métallique (truss) façon vrai festival, commune aux 6 décors :
// placée le plus haut possible, sur toute la largeur de la salle, pour
// accrocher les lyres beam/wash, les lasers et les canons CO2 (cf. plus bas).
// Géométrie centralisée ici pour que le rendu statique (drawTrussStructure)
// et les faisceaux animés (drawTrussLights, cf. section effets lumineux)
// restent toujours parfaitement alignés sur les mêmes points d'accroche.
function trussBounds() {
  const trussY = Math.max(16, H * 0.028);
  const xLeft = W * 0.035;
  const xRight = W * 0.965;
  const cx = W / 2;
  const halfSpan = cx - xLeft;
  return { trussY, xLeft, xRight, cx, halfSpan };
}

// Emplacement de chaque projecteur accroché à la structure. Du centre vers
// l'extérieur, sur chaque côté (symétrique) : laser, canon CO2, puis la
// rangée de lyres wash/beam/beam/beam/beam/wash — même logique qu'une vraie
// fiche de patch de festival, avec les wash qui encadrent les beam.
function trussFixturePositions() {
  const { trussY, cx, halfSpan } = trussBounds();
  const headFracs = [
    { frac: 0.34, type: 'wash' },
    { frac: 0.47, type: 'beam' },
    { frac: 0.60, type: 'beam' },
    { frac: 0.73, type: 'beam' },
    { frac: 0.86, type: 'beam' },
    { frac: 0.97, type: 'wash' },
  ];
  const movingHeads = [];
  [-1, 1].forEach(side => {
    headFracs.forEach((f, i) => {
      const x = cx + side * f.frac * halfSpan;
      const drop = f.type === 'wash' ? 20 : 15;
      movingHeads.push({ x, y: trussY + drop, side, type: f.type, seed: (side > 0 ? i : i + 100) * 17.3 });
    });
  });

  const lasers = [-1, 1].map((side, i) => ({ x: cx + side * 0.08 * halfSpan, y: trussY + 12, side, seed: i * 53.1 + 7 }));
  const co2 = [-1, 1].map((side, i) => ({ x: cx + side * 0.20 * halfSpan, y: trussY + 12, side, seed: i * 29.7 }));

  return { trussY, cx, halfSpan, movingHeads, lasers, co2 };
}

// Housing (corps) statique d'une lyre beam/wash : bras de fixation vers la
// structure + caisson sombre + lentille. Les wash sont plus larges/courtes
// (flood diffus), les beam plus fines/longues (faisceau serré), comme du
// vrai matériel de scène.
function drawMovingHeadHousing(h) {
  const isWash = h.type === 'wash';
  const bodyW = isWash ? 15 : 10;
  const bodyH = isWash ? 15 : 18;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.strokeStyle = '#20242b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#1c1f26';
  roundRect(ctx, -bodyW / 2, 0, bodyW, bodyH, isWash ? 6 : 4);
  ctx.fill();
  strokeOutline(ctx, '#1c1f26', 1.4);
  ctx.fillStyle = '#4a5058';
  ctx.beginPath();
  ctx.arc(0, bodyH * 0.6, bodyW * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Housing statique d'un projecteur laser (petit boîtier plat + lentille noire).
function drawLaserProjectorHousing(l) {
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.fillStyle = '#15171c';
  roundRect(ctx, -12, 0, 24, 13, 4);
  ctx.fill();
  strokeOutline(ctx, '#15171c', 1.4);
  ctx.fillStyle = '#0c0d10';
  ctx.beginPath();
  ctx.arc(0, 9, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Housing statique d'un canon à CO2 accroché à la structure, buse vers le bas.
function drawCo2CannonHousing(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.fillStyle = '#2a2e35';
  roundRect(ctx, -7, 0, 14, 22, 3);
  ctx.fill();
  strokeOutline(ctx, '#2a2e35', 1.4);
  ctx.fillStyle = '#12141a';
  roundRect(ctx, -4, 20, 8, 8, 2);
  ctx.fill();
  ctx.restore();
}

// Rendu statique de la structure elle-même : palans/câbles vers le plafond,
// poutre "box truss" (deux rails + treillis en zigzag + rivets, façon vraie
// structure alu de festival) sur toute la largeur, et les housings de tous
// les projecteurs qui y sont accrochés. Appelée une fois par frame depuis
// drawBackground, sur les 6 décors (aucune scène n'y échappe).
function drawTrussStructure(theme, t, pulseEnv) {
  const { trussY, xLeft, xRight, cx, halfSpan } = trussBounds();
  const pos = trussFixturePositions();
  const steel = '#3a3f47';
  const steelLight = '#6b7280';
  const steelDark = '#20242b';

  // câbles/palans de suspension, répartis symétriquement jusqu'au plafond
  const hangXs = [cx, cx - 0.35 * halfSpan, cx + 0.35 * halfSpan, cx - 0.7 * halfSpan, cx + 0.7 * halfSpan, cx - 0.97 * halfSpan, cx + 0.97 * halfSpan];
  ctx.strokeStyle = 'rgba(20,20,26,0.55)';
  ctx.lineWidth = 2;
  hangXs.forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, trussY - 7);
    ctx.stroke();
    ctx.fillStyle = steelDark;
    roundRect(ctx, x - 6, trussY - 16, 12, 12, 2);
    ctx.fill();
  });

  // poutre principale façon "box truss" : deux rails + treillis en zigzag
  const railGap = 15;
  const topRailY = trussY - railGap / 2;
  const botRailY = trussY + railGap / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(xLeft, botRailY + 2, xRight - xLeft, 5);

  ctx.strokeStyle = steel;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let up = true;
  for (let x = xLeft; x <= xRight; x += 17) {
    ctx.lineTo(x, up ? topRailY : botRailY);
    up = !up;
  }
  ctx.stroke();

  [topRailY, botRailY].forEach(y => {
    ctx.strokeStyle = steelDark;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.stroke();
    ctx.strokeStyle = steelLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xLeft, y - 1);
    ctx.lineTo(xRight, y - 1);
    ctx.stroke();
  });

  ctx.fillStyle = steelLight;
  for (let x = xLeft; x <= xRight; x += 34) {
    ctx.beginPath();
    ctx.arc(x, topRailY, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, botRailY, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  [xLeft, xRight].forEach(x => {
    ctx.fillStyle = steelDark;
    roundRect(ctx, x - 4, topRailY - 3, 8, railGap + 6, 2);
    ctx.fill();
  });

  pos.movingHeads.forEach(h => drawMovingHeadHousing(h));
  pos.lasers.forEach(l => drawLaserProjectorHousing(l));
  pos.co2.forEach(c => drawCo2CannonHousing(c));
}

