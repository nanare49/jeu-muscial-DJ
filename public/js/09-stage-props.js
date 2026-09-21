// 09-stage-props.js
// Podium du DJ, platines, et barrière de sécurité devant la scène.
// Podium surélevé du DJ, commun aux 3 mainstages : une estrade avec une face avant
// visible, pour bien montrer que le DJ est en hauteur par rapport au public.
function drawStagePlatform(theme) {
  const { topY, botY, halfW, cx } = stagePlatformBounds();

  ctx.fillStyle = shadeColor(theme.stage, -18);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY + 8);
  ctx.lineTo(cx + halfW, topY + 8);
  ctx.lineTo(cx + halfW * 1.06, botY);
  ctx.lineTo(cx - halfW * 1.06, botY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeColor(theme.stage, 22);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY + 8);
  ctx.lineTo(cx + halfW, topY + 8);
  ctx.lineTo(cx + halfW * 0.9, topY);
  ctx.lineTo(cx - halfW * 0.9, topY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY + 8);
  ctx.lineTo(cx + halfW, topY + 8);
  ctx.stroke();
}

// Cabine DJ (platines + table de mixage) posée sur le podium : indépendante de
// tout joueur (le DJ n'est plus figé sur scène, il est sur la piste comme les
// festivaliers - cf. drawPlayer), mais le décor de scène doit quand même
// montrer du matériel de DJ. Dessinée une seule fois par frame dans
// drawBackground, juste après le podium.
function drawStageDeckProp(theme) {
  const { topY, cx } = stagePlatformBounds();
  ctx.save();
  ctx.translate(cx, topY - 30);

  // ombre portée sur le podium
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 32, 92, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // caisson de la cabine
  ctx.fillStyle = '#2a2140';
  roundRect(ctx, -80, -28, 160, 56, 12);
  ctx.fill();
  strokeOutline(ctx, '#2a2140', 2);
  ctx.fillStyle = shadeColor('#2a2140', 16);
  roundRect(ctx, -80, -28, 160, 13, 11);
  ctx.fill();

  // deux platines vinyle, chacune dans son propre sous-chemin (jamais deux
  // arcs dans un même chemin sans beginPath : ça les relie par un trait droit)
  [-36, 36].forEach(px => {
    ctx.fillStyle = '#151022';
    ctx.beginPath();
    ctx.arc(px, 6, 17, 0, Math.PI * 2);
    ctx.fill();
    strokeOutline(ctx, '#151022', 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (let r = 5; r < 16; r += 3.4) {
      ctx.beginPath();
      ctx.arc(px, 6, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(px, 6, 3.6, 0, Math.PI * 2);
    ctx.fill();
  });

  // petite table de mixage centrale
  ctx.fillStyle = '#1a1526';
  roundRect(ctx, -13, -8, 26, 24, 4);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  [-8, 0, 8].forEach(dx => {
    ctx.beginPath();
    ctx.arc(dx, 3, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

// Bornes de la barrière de sécurité : sa base (au sol, cf. stageMinY) et le haut
// de sa lisse supérieure. Réutilisé par le rendu des flammes pour les faire
// démarrer juste derrière la barrière, jamais devant ni au milieu du public.
function crowdBarrierBounds() {
  const { botY } = stagePlatformBounds();
  const fenceH = 34; // barrière plus haute qu'avant, façon vraie barrière de sécurité
  return { baseY: botY, topY: botY - fenceH, midY: botY - fenceH * 0.45 };
}

// Barrière de sécurité sur toute la largeur devant la scène, façon vraie
// barrière métallique de festival (montants + double lisse) : matérialise la
// limite que les festivaliers ne peuvent pas franchir (cf. stageMinY).
function drawCrowdBarrier() {
  const { baseY, topY, midY } = crowdBarrierBounds();

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, baseY, W, 4);

  ctx.strokeStyle = '#7d8593';
  ctx.lineWidth = 3;
  for (let x = 14; x < W; x += 58) {
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, topY);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 3;
  for (let x = 14; x < W; x += 58) {
    ctx.beginPath();
    ctx.moveTo(x - 7, baseY);
    ctx.lineTo(x + 7, baseY);
    ctx.stroke();
  }

  ctx.strokeStyle = '#5f6772';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(W, midY);
  ctx.stroke();

  ctx.strokeStyle = '#9aa3b2';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, topY);
  ctx.lineTo(W, topY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, topY - 2);
  ctx.lineTo(W, topY - 2);
  ctx.stroke();
}

