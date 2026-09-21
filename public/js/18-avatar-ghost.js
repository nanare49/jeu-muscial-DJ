// 18-avatar-ghost.js
// Avatar « Fantôme ».
// --- avatar "Fantôme" : flotte, pas de jambes ---
function drawGhostBody(c, move, accessory, color, isMe, t, motionState) {
  const raw = {
    bobBase: Math.sin(t / 500) * 5,
    extra: move === 'jump' ? Math.abs(Math.sin(t / 200)) * 14
      : move === 'hands_up' ? Math.abs(Math.sin(t / 260)) * 6
      : (move === 'dance1' || move === 'dance2') ? Math.abs(Math.sin(t / 280)) * 8 : 0,
    sway: (move === 'dance1' || move === 'dance2') ? Math.sin(t / 320) * 12 : Math.sin(t / 700) * 3
  };
  const { bobBase, extra, sway } = smoothMotion(motionState || {}, raw, t);
  c.translate(sway, -(bobBase + extra));

  c.save();
  c.translate(-sway, bobBase + extra);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath();
  c.ellipse(0, 40, 16, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();

  c.globalAlpha = 0.9;
  c.fillStyle = radialBodyGradient(c, -5, -18, 22, color);
  c.beginPath();
  c.arc(0, -12, 20, Math.PI, 0);
  c.lineTo(20, 24);
  c.quadraticCurveTo(12, 14, 6, 24);
  c.quadraticCurveTo(0, 14, -6, 24);
  c.quadraticCurveTo(-12, 14, -20, 24);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  strokeOutline(c, color, 2.4);
  drawFlatHighlight(c, -7, -20, 5, 7, 0.16);

  c.fillStyle = '#0d0a14';
  c.beginPath();
  c.ellipse(-7, -14, 3.2, 4.5, 0, 0, Math.PI * 2);
  c.ellipse(7, -14, 3.2, 4.5, 0, 0, Math.PI * 2);
  c.fill();

  // petit nœud papillon, comme un vêtement distinct sur ce corps qui flotte
  const bowTone = shadeColor(color, -40);
  c.fillStyle = bowTone;
  c.beginPath();
  c.moveTo(-1.5, -4); c.lineTo(-8, -8); c.lineTo(-8, 0); c.closePath();
  c.moveTo(1.5, -4); c.lineTo(8, -8); c.lineTo(8, 0); c.closePath();
  c.fill();
  strokeOutline(c, bowTone, 1.4);
  c.fillStyle = shadeColor(bowTone, -20);
  c.beginPath();
  c.arc(0, -4, 2.4, 0, Math.PI * 2);
  c.fill();

  if (accessory === 'cap') {
    c.fillStyle = '#2f9e6b';
    c.beginPath();
    c.arc(0, -28, 14, Math.PI * 0.9, Math.PI * 2.1);
    c.fill();
    strokeOutline(c, '#2f9e6b', 1.8);
  } else if (accessory === 'hat') {
    c.fillStyle = '#caa25a';
    c.beginPath();
    c.ellipse(0, -32, 18, 4, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 1.8);
  }
  drawPremiumAccessory(c, accessory, -22, 15);
}

