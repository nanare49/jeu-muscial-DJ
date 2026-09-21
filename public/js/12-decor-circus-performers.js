// 12-decor-circus-performers.js
// Décor du Mainstage Cirque (chapiteaux, fanions, grande roue) et ses petits numéros de piste (clown, acrobate, cracheur de flammes, cheval).
// --- Mainstage "Cirque" : chapiteaux rayés, fanions, tourelles et grande roue ---
function drawMainstageCircus(theme, t) {
  const cx = W / 2;

  [W * 0.08, W * 0.92].forEach(tx => {
    const shaftTopY = H * 0.10, shaftBotY = H * 0.36, shaftW = W * 0.04;
    ctx.fillStyle = shadeColor(theme.stage, -10);
    ctx.fillRect(tx - shaftW / 2, shaftTopY, shaftW, shaftBotY - shaftTopY);
    // toit conique pointu (façon chapiteau), plus large que le mât : silhouette
    // de tourelle de cirque sans ambiguïté, plutôt qu'un dôme arrondi.
    const roofW = shaftW * 2.1, roofH = H * 0.05;
    const roofBaseY = shaftTopY + 4;
    ctx.beginPath();
    ctx.moveTo(tx, roofBaseY - roofH);
    ctx.lineTo(tx + roofW / 2, roofBaseY);
    ctx.lineTo(tx - roofW / 2, roofBaseY);
    ctx.closePath();
    const roofGrad = ctx.createLinearGradient(tx, roofBaseY - roofH, tx, roofBaseY);
    roofGrad.addColorStop(0, shadeColor(theme.stage, 26));
    roofGrad.addColorStop(1, shadeColor(theme.stage, 4));
    ctx.fillStyle = roofGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // petit fanion tout en haut
    ctx.strokeStyle = '#3a2f1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx, roofBaseY - roofH);
    ctx.lineTo(tx, roofBaseY - roofH - 10);
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(tx, roofBaseY - roofH - 10);
    ctx.lineTo(tx + 9, roofBaseY - roofH - 6);
    ctx.lineTo(tx, roofBaseY - roofH - 3);
    ctx.closePath();
    ctx.fill();
  });

  ctx.fillStyle = theme.stage;
  ctx.fillRect(W * 0.24, H * 0.14, W * 0.52, H * 0.20);

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W * 0.08, H * 0.11);
  ctx.quadraticCurveTo(cx, H * 0.16, W * 0.92, H * 0.11);
  ctx.stroke();

  const peaks = [
    { x: W * 0.36, apex: H * 0.06, base: H * 0.14, w: W * 0.10 },
    { x: cx, apex: H * 0.025, base: H * 0.14, w: W * 0.12 },
    { x: W * 0.64, apex: H * 0.06, base: H * 0.14, w: W * 0.10 }
  ];
  peaks.forEach(p => {
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#c22f2f' : '#f3ede0';
      ctx.beginPath();
      const x0 = p.x - p.w / 2 + i * (p.w / stripes);
      const x1 = x0 + p.w / stripes;
      ctx.moveTo(p.x, p.apex);
      ctx.lineTo(x0, p.base);
      ctx.lineTo(x1, p.base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#3a2f1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.apex);
    ctx.lineTo(p.x, p.apex - 14);
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(p.x, p.apex - 14);
    ctx.lineTo(p.x + 12, p.apex - 9);
    ctx.lineTo(p.x, p.apex - 5);
    ctx.closePath();
    ctx.fill();
  });

  // Grande roue : une à gauche, une identique en miroir à droite (chacune
  // accueille son propre écran LED rond avec la pieuvre, cf. vjScreenLayout/
  // circusWheelSpec — même position/rayon des deux côtés).
  circusWheelSpec().forEach(w => drawCircusFerrisWheel(w.cx, w.cy, w.r, t));

  ctx.save();
  ctx.fillStyle = '#ffe08a';
  for (let i = 0; i < 10; i++) {
    const tw = 0.4 + Math.abs(Math.sin(t / 260 + i));
    ctx.globalAlpha = tw;
    ctx.beginPath();
    ctx.arc(W * 0.26 + i * (W * 0.48 / 9), H * 0.345, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Petits numéros de piste (clown, acrobate, cracheur de flammes, cheval),
  // glissés dans les coins libres du décor (jamais sous le grand écran ni sur
  // la piste elle-même — cf. drawCircusClown & co.).
  drawCircusClown(W * 0.045, H * 0.31, t, 0.8);
  drawCircusAcrobat(W * 0.14, H * 0.13, t, 0.9);
  drawCircusFireBreather(W * 0.955, H * 0.165, t, 0.8);
  drawCircusHorse(W * 0.955, H * 0.32, t, 0.75);
}

// Petit clown flat-illustration : combinaison à pois, collerette, chapeau
// pointu et nez rouge — idle bounce léger.
function drawCircusClown(cx, baseY, t, scale) {
  const bob = Math.sin(t / 400) * 2;
  ctx.save();
  ctx.translate(cx, baseY + bob);
  ctx.scale(scale || 1, scale || 1);
  ctx.strokeStyle = '#2d6b6b';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -6); ctx.lineTo(-9, 14);
  ctx.moveTo(6, -6); ctx.lineTo(9, 14);
  ctx.stroke();
  ctx.fillStyle = '#e8b84b';
  ctx.beginPath(); ctx.ellipse(-11, 15, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(11, 15, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8536b';
  roundRect(ctx, -14, -30, 28, 26, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  [[-6, -22], [5, -16], [-2, -10]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.arc(dx, dy, 2.4, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#f3ede0';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 13, -30 + Math.sin(a) * 5, 6, 3, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffe3c2';
  ctx.beginPath(); ctx.arc(0, -42, 12, 0, Math.PI * 2); ctx.fill();
  strokeOutline(ctx, '#ffe3c2', 1.6);
  ctx.fillStyle = '#ff8c3d';
  ctx.beginPath(); ctx.arc(-11, -40, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11, -40, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4da6ff';
  ctx.beginPath();
  ctx.moveTo(-9, -50); ctx.lineTo(9, -50); ctx.lineTo(0, -68);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd35a';
  ctx.beginPath(); ctx.arc(0, -68, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1c1a24';
  ctx.beginPath(); ctx.arc(-4, -43, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -43, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1c1a24';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, -38, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#e8384a';
  ctx.beginPath(); ctx.arc(0, -40, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Acrobate suspendue dans un cerceau, en pleine figure (étoile), qui tourne
// doucement — placée juste au-dessus de la grande roue de feu d'artifice.
function drawCircusAcrobat(cx, cy, t, scale) {
  const spin = t / 900;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale || 1, scale || 1);
  ctx.rotate(Math.sin(spin) * 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#c084fc';
  roundRect(ctx, -5, -12, 10, 18, 4);
  ctx.fill();
  strokeOutline(ctx, '#c084fc', 1.4);
  ctx.fillStyle = '#ffe3c2';
  ctx.beginPath(); ctx.arc(0, -16, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, -8); ctx.lineTo(-18, -16);
  ctx.moveTo(5, -8); ctx.lineTo(18, -16);
  ctx.moveTo(-3, 6); ctx.lineTo(-14, 16);
  ctx.moveTo(3, 6); ctx.lineTo(14, 16);
  ctx.stroke();
  ctx.restore();
}

// Cracheur de flammes : tête renversée en arrière, jet de flamme soufflé
// vers le haut (même silhouette de flamme que les torches).
function drawCircusFireBreather(cx, baseY, t, scale) {
  const puff = 0.6 + Math.abs(Math.sin(t / 160)) * 0.4;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(scale || 1, scale || 1);
  ctx.strokeStyle = '#1c1a24';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, -6); ctx.lineTo(-7, 14);
  ctx.moveTo(5, -6); ctx.lineTo(7, 14);
  ctx.stroke();
  ctx.fillStyle = '#3a2438';
  roundRect(ctx, -10, -28, 20, 24, 6);
  ctx.fill();
  strokeOutline(ctx, '#3a2438', 1.6);
  ctx.save();
  ctx.translate(0, -34);
  ctx.rotate(-0.35);
  ctx.fillStyle = '#e0a878';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(6, -42);
  ctx.rotate(-0.5);
  const fh = 40 * puff, fw = 16 * puff;
  ctx.beginPath();
  traceFlameShape(0, 0, fw, fh);
  const fg = ctx.createLinearGradient(0, 0, 0, -fh);
  fg.addColorStop(0, 'rgba(150,20,20,0.9)');
  fg.addColorStop(0.55, 'rgba(255,120,40,0.92)');
  fg.addColorStop(1, 'rgba(255,214,120,0.85)');
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// Cheval au galop, vu de profil, tourné vers le centre de la scène, avec
// panache façon cheval de cirque.
function drawCircusHorse(cx, baseY, t, scale) {
  const gallop = Math.sin(t / 260);
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(-(scale || 1), scale || 1);
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath();
  ctx.ellipse(0, -14, 20, 11, -0.08, 0, Math.PI * 2);
  ctx.fill();
  strokeOutline(ctx, '#8a5a34', 1.6);
  ctx.beginPath();
  ctx.moveTo(16, -20);
  ctx.quadraticCurveTo(26, -30, 24, -38);
  ctx.quadraticCurveTo(30, -40, 32, -34);
  ctx.quadraticCurveTo(26, -26, 18, -12);
  ctx.closePath();
  ctx.fill();
  strokeOutline(ctx, '#8a5a34', 1.4);
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.moveTo(14, -22); ctx.quadraticCurveTo(20, -32, 26, -40);
  ctx.quadraticCurveTo(20, -30, 12, -18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-14, -8); ctx.lineTo(-20 + gallop * 6, 12);
  ctx.moveTo(-4, -6); ctx.lineTo(2 - gallop * 8, 12);
  ctx.moveTo(10, -8); ctx.lineTo(16 + gallop * 6, 12);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-20, -16);
  ctx.quadraticCurveTo(-30, -8 + gallop * 4, -28, 4);
  ctx.stroke();
  ctx.fillStyle = '#ff5fa3';
  ctx.beginPath();
  ctx.moveTo(24, -38); ctx.lineTo(30, -46); ctx.lineTo(26, -34);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

