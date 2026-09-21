// 17-avatar-alien.js
// Avatar « Alien ».
// --- avatar "Alien" : grosse tête, grands yeux ---
function drawAlienBody(c, move, accessory, color, isMe, t, motionState) {
  const { armLift, bob, sway, legSpread } = smoothMotion(motionState || {}, motionFor(move, t), t);
  c.translate(sway, -bob);
  drawShadow(c, sway, bob);

  c.fillStyle = color;
  c.beginPath();
  traceRoundRect(c, -10, 8, 8, 16, 3);
  traceRoundRect(c, 2, 8, 8, 16, 3);
  c.fill();
  strokeOutline(c, color, 2.2);

  const armY = -2 - armLift * 18;
  drawLimbTube(c, -11, -2, -20, armY, 7, color);
  drawLimbTube(c, 11, -2, 20, armY, 7, color);

  c.fillStyle = linearBodyGradient(c, -12, -10, 24, 24, color);
  roundRect(c, -12, -10, 24, 24, 10);
  c.fill();
  strokeOutline(c, color, 2.4);
  // col de combinaison, pour un vêtement distinct plutôt qu'une peau nue
  c.fillStyle = shadeColor(color, -32);
  roundRect(c, -12, -10, 24, 6, 6);
  c.fill();
  drawFlatHighlight(c, -4, -4, 5, 8, 0.14);

  // grosse tête ovale
  c.fillStyle = radialBodyGradient(c, -5, -38, 22, color);
  c.beginPath();
  c.ellipse(0, -32, 20, 24, 0, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, color, 2.6);
  drawFlatHighlight(c, -7, -40, 5, 7, 0.16);

  // grands yeux noirs en amande
  c.fillStyle = '#0d0a14';
  c.beginPath();
  c.ellipse(-8, -34, 6, 9, -0.2, 0, Math.PI * 2);
  c.ellipse(8, -34, 6, 9, 0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath();
  c.arc(-6, -37, 1.5, 0, Math.PI * 2);
  c.arc(10, -37, 1.5, 0, Math.PI * 2);
  c.fill();

  if (accessory === 'cap') {
    c.fillStyle = '#2f9e6b';
    c.beginPath();
    c.arc(0, -46, 19, Math.PI * 0.9, Math.PI * 2.1);
    c.fill();
    strokeOutline(c, '#2f9e6b', 2);
  } else if (accessory === 'hat') {
    c.fillStyle = '#caa25a';
    c.beginPath();
    c.ellipse(0, -52, 24, 5, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 2);
  }
  drawPremiumAccessory(c, accessory, -32, 20);
}

