// 11-decor-mainstages.js
// Décor spécifique de chaque mainstage : Temple (colonnade/torches), Arena (trusse de projecteurs), Electro (enceintes néon), et la grande roue du Cirque.
// --- Mainstage "Temple" : façade antique, colonnade, tours à casques et torches ---
function drawMainstageTemple(theme, t) {
  const cx = W / 2;

  ctx.fillStyle = theme.stage;
  ctx.fillRect(W * 0.20, H * 0.10, W * 0.60, H * 0.24);

  ctx.fillStyle = shadeColor(theme.stage, 10);
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.035);
  ctx.lineTo(W * 0.28, H * 0.10);
  ctx.lineTo(W * 0.72, H * 0.10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(cx, H * 0.075, 9, 0, Math.PI * 2);
  ctx.fill();

  const screenGrad = ctx.createRadialGradient(cx, H * 0.20, 4, cx, H * 0.20, W * 0.10);
  screenGrad.addColorStop(0, theme.accent);
  screenGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = screenGrad;
  ctx.fillRect(W * 0.40, H * 0.12, W * 0.20, H * 0.18);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(W * 0.40, H * 0.12, W * 0.20, H * 0.18);

  for (let i = 0; i < 6; i++) {
    const x = W * 0.24 + i * (W * 0.52 / 5);
    ctx.fillStyle = shadeColor(theme.stage, 16);
    ctx.fillRect(x - 4, H * 0.11, 8, H * 0.22);
  }

  [W * 0.10, W * 0.90].forEach((tx, i) => {
    // Pylône de temple antique : forme trapézoïdale (base large, sommet plus
    // étroit, façon obélisque) plutôt qu'un simple pilier droit — silhouette
    // de tour de temple sans ambiguïté.
    const baseW = W * 0.06, topW = W * 0.036;
    const towerTopY = H * 0.075, towerBaseY = H * 0.34;
    ctx.fillStyle = shadeColor(theme.stage, -6);
    ctx.beginPath();
    ctx.moveTo(tx - topW / 2, towerTopY);
    ctx.lineTo(tx + topW / 2, towerTopY);
    ctx.lineTo(tx + baseW / 2, towerBaseY);
    ctx.lineTo(tx - baseW / 2, towerBaseY);
    ctx.closePath();
    ctx.fill();
    // corniche claire qui marque le sommet du pylône
    ctx.fillStyle = shadeColor(theme.stage, 14);
    ctx.fillRect(tx - topW / 2 - 3, towerTopY, topW + 6, 7);
    // gravures verticales stylisées
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    [-1, 0, 1].forEach(g => {
      ctx.beginPath();
      ctx.moveTo(tx + g * topW * 0.28, towerTopY + 16);
      ctx.lineTo(tx + g * baseW * 0.24, towerBaseY - 10);
      ctx.stroke();
    });

    // vasque évasée (brasero), plus large que le pylône, portée à son sommet :
    // c'est d'elle que jaillit la flamme, pour une silhouette de torche
    // clairement lisible.
    const bowlY = towerTopY - 2, bowlW = topW * 1.7, bowlH = 10;
    ctx.fillStyle = '#8a7248';
    ctx.beginPath();
    ctx.moveTo(tx - bowlW / 2, bowlY - bowlH);
    ctx.lineTo(tx + bowlW / 2, bowlY - bowlH);
    ctx.lineTo(tx + bowlW * 0.32, bowlY);
    ctx.lineTo(tx - bowlW * 0.32, bowlY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8b84b';
    ctx.fillRect(tx - 2, bowlY - bowlH - 3, 4, 4);

    const flick = 0.75 + Math.sin(t / 140 + i * 2) * 0.25;
    const torchBaseY = bowlY - bowlH - 2;
    const torchH = 30 * flick, torchW = 17 * flick;
    ctx.beginPath();
    traceFlameShape(tx, torchBaseY, torchW, torchH);
    const torchGrad = ctx.createLinearGradient(tx, torchBaseY, tx, torchBaseY - torchH);
    torchGrad.addColorStop(0, 'rgba(150,20,20,0.9)');
    torchGrad.addColorStop(0.55, 'rgba(255,120,40,0.92)');
    torchGrad.addColorStop(1, 'rgba(255,214,120,0.85)');
    ctx.fillStyle = torchGrad;
    ctx.fill();
    ctx.beginPath();
    traceFlameShape(tx, torchBaseY - torchH * 0.02, torchW * 0.5, torchH * 0.6);
    const torchInnerGrad = ctx.createLinearGradient(tx, torchBaseY, tx, torchBaseY - torchH * 0.6);
    torchInnerGrad.addColorStop(0, 'rgba(255,150,50,0.85)');
    torchInnerGrad.addColorStop(1, 'rgba(255,244,200,0.9)');
    ctx.fillStyle = torchInnerGrad;
    ctx.fill();
  });
}

// --- Mainstage "Arena" : grand écran large surmonté d'une arche arc-en-ciel ---
function drawMainstageArena(theme, t) {
  const cx = W / 2;

  ctx.fillStyle = theme.stage;
  ctx.fillRect(W * 0.16, H * 0.15, W * 0.68, H * 0.20);

  // Trusse portant une rangée de projecteurs mobiles qui balaient doucement
  // la scène (façon vrai plan de feux de concert), plutôt que l'ancienne
  // arche arc-en-ciel fixe.
  const trussY = H * 0.155, trussX1 = W * 0.20, trussX2 = W * 0.80;
  ctx.fillStyle = '#22222a';
  ctx.fillRect(trussX1, trussY - 5, trussX2 - trussX1, 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  for (let x = trussX1; x <= trussX2; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, trussY - 5); ctx.lineTo(x, trussY + 3); ctx.stroke();
  }

  const spotColors = ['#ff4d6d', '#ffb703', '#8ecae6', '#06d6a0', '#a663cc', '#ff8c3d'];
  spotColors.forEach((color, i) => {
    const sx = trussX1 + (trussX2 - trussX1) * ((i + 0.5) / spotColors.length);
    const sy = trussY + 4;
    const pan = Math.sin(t / 1500 + i * 1.3) * 0.5; // léger balayage, chacun déphasé
    const angle = Math.PI / 2 + pan;
    const len = H * 0.26;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(pan * 0.4);
    ctx.fillStyle = '#33333d';
    roundRect(ctx, -6, -4, 12, 12, 3);
    ctx.fill();
    ctx.restore();

    const x2 = sx + Math.cos(angle) * len;
    const y2 = sy + Math.sin(angle) * len;
    const perp = angle + Math.PI / 2;
    const spread = len * 0.11;
    const rgb = hexToRgb(color);
    const beamGrad = ctx.createLinearGradient(sx, sy, x2, y2);
    beamGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`);
    beamGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(x2 + Math.cos(perp) * spread, y2 + Math.sin(perp) * spread);
    ctx.lineTo(x2 - Math.cos(perp) * spread, y2 - Math.sin(perp) * spread);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  [W * 0.09, W * 0.91].forEach(tx => {
    ctx.fillStyle = shadeColor(theme.stage, -8);
    ctx.fillRect(tx - W * 0.035, H * 0.14, W * 0.07, H * 0.22);
    ctx.save();
    ctx.fillStyle = theme.accent;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        const flick = 0.4 + Math.abs(Math.sin(t / 300 + r + c));
        ctx.globalAlpha = Math.min(1, 0.25 + flick * 0.4);
        ctx.beginPath();
        ctx.arc(tx - W * 0.02 + c * W * 0.02, H * 0.17 + r * H * 0.035, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  });

  ctx.fillStyle = theme.accent;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(W * 0.20 + i * (W * 0.60 / 7), H * 0.345, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Mainstage "Electro" : l'écran central (commun à tous les décors, cf.
// djScreenBounds/drawDjBigScreen) flanqué de deux tours d'enceintes de sa
// hauteur, cerclées de néons — ambiance club électro épurée. ---
function drawMainstageElectro(theme, t) {
  const { x: sx, y: sy, width: sw, height: sh } = djScreenBounds();

  ctx.fillStyle = theme.stage;
  ctx.fillRect(W * 0.10, sy - 10, W * 0.80, sh + 40);

  const pulse = 0.5 + Math.sin(t / 500) * 0.5;
  ctx.strokeStyle = `rgba(70,255,220,${0.35 + pulse * 0.4})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.10, sy + sh + 26);
  ctx.lineTo(W * 0.90, sy + sh + 26);
  ctx.stroke();

  const stackW = Math.min(W * 0.11, sw * 0.22);
  drawElectroSpeakerStack(sx - 14 - stackW, sy, stackW, sh, t, -1);
  drawElectroSpeakerStack(sx + sw + 14, sy, stackW, sh, t, 1);
}

// Une tour d'enceintes façon festival électro : plusieurs caissons empilés,
// chacun avec ses haut-parleurs (grave en bas, médiums au-dessus), le tout
// cerclé d'un contour néon qui pulse doucement.
function drawElectroSpeakerStack(x, y, w, h, t, side) {
  const stages = 3;
  const stageH = h / stages;
  for (let i = 0; i < stages; i++) {
    const sy0 = y + i * stageH;
    ctx.fillStyle = shadeColor('#1a1a22', i % 2 === 0 ? 6 : -4);
    roundRect(ctx, x, sy0 + 2, w, stageH - 4, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const woofers = i === stages - 1 ? 1 : 2;
    for (let wi = 0; wi < woofers; wi++) {
      const cxw = x + w * ((wi + 1) / (woofers + 1));
      const cyw = sy0 + stageH / 2;
      const r = Math.min(w, stageH) * (woofers === 1 ? 0.32 : 0.26);
      const thump = 1 + Math.sin(t / 260 + i * 2 + wi) * 0.05;
      const grad = ctx.createRadialGradient(cxw, cyw, r * 0.1, cxw, cyw, r * thump);
      grad.addColorStop(0, '#0c0c10');
      grad.addColorStop(0.7, '#26262e');
      grad.addColorStop(1, '#0a0a0e');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cxw, cyw, r * thump, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,255,220,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#050508';
      ctx.beginPath();
      ctx.arc(cxw, cyw, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const neonPulse = 0.5 + Math.sin(t / 480 + (side || 0)) * 0.5;
  ctx.strokeStyle = `rgba(70,255,220,${0.5 + neonPulse * 0.4})`;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(70,255,220,0.8)';
  ctx.shadowBlur = 10 + neonPulse * 10;
  roundRect(ctx, x, y, w, h, 6);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Grande roue de cirque : juste le cercle + les nacelles qui tournent (le
// contenu du centre — l'écran LED rond avec la pieuvre — est dessiné à part
// par-dessus, cf. drawVjScreenPanel/vjScreenLayout).
function drawCircusFerrisWheel(fwx, fwy, fwr, t) {
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fwx, fwy, fwr, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t / 2000;
    ctx.beginPath();
    ctx.arc(fwx + Math.cos(a) * fwr, fwy + Math.sin(a) * fwr, 3, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? '#ff5fa3' : '#5ad1ff';
    ctx.fill();
  }
}

