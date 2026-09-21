// 19-avatar-dragon.js
// Avatar « Dragonnet ».
// --- avatar "Dragonnet" : cornes, ailes, queue ---
function drawDragonBody(c, move, accessory, color, isMe, t, motionState) {
  const { armLift, bob, sway, legSpread } = smoothMotion(motionState || {}, motionFor(move, t), t);
  c.translate(sway, -bob);
  drawShadow(c, sway, bob);

  // queue (tube avec contour, comme les autres membres)
  c.beginPath();
  c.moveTo(0, 20); c.quadraticCurveTo(18, 26, 14, 10);
  c.strokeStyle = shadeColor(color, -42);
  c.lineWidth = 10;
  c.lineCap = 'round';
  c.stroke();
  c.beginPath();
  c.moveTo(0, 20); c.quadraticCurveTo(18, 26, 14, 10);
  c.strokeStyle = color;
  c.lineWidth = 6;
  c.stroke();

  // jambes
  c.fillStyle = color;
  c.beginPath();
  traceRoundRect(c, -12, 14, 8, 14, 3);
  traceRoundRect(c, 4, 14, 8, 14, 3);
  c.fill();
  strokeOutline(c, color, 2.2);

  // corps
  c.fillStyle = linearBodyGradient(c, -15, -14, 30, 32, color);
  roundRect(c, -15, -14, 30, 32, 12);
  c.fill();
  strokeOutline(c, color, 2.4);
  // plaques du ventre, façon écailles/armure — un "vêtement" propre au dragon
  const bellyTone = shadeColor(color, 12);
  c.fillStyle = bellyTone;
  [-6, 2, 10].forEach(y => {
    c.beginPath();
    c.ellipse(0, y, 6, 3.4, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, bellyTone, 1.2);
  });
  drawFlatHighlight(c, -5, -6, 6, 10, 0.14);

  // ailes (s'écartent avec les mains en l'air / saut)
  const wingSpread = 0.4 + armLift * 0.6;
  c.fillStyle = color;
  c.globalAlpha = 0.85;
  c.beginPath();
  c.moveTo(-14, -4);
  c.lineTo(-14 - 22 * wingSpread, -14 - 10 * wingSpread);
  c.lineTo(-10, -14);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  strokeOutline(c, color, 2);
  c.globalAlpha = 0.85;
  c.beginPath();
  c.moveTo(14, -4);
  c.lineTo(14 + 22 * wingSpread, -14 - 10 * wingSpread);
  c.lineTo(10, -14);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  strokeOutline(c, color, 2);

  // tête
  c.fillStyle = color;
  c.beginPath();
  c.arc(0, -28, 14, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, color, 2.4);
  // cornes
  c.fillStyle = '#e9e4f2';
  c.beginPath();
  c.moveTo(-8, -38); c.lineTo(-4, -48); c.lineTo(-2, -38); c.closePath();
  c.fill();
  strokeOutline(c, '#e9e4f2', 1.8);
  c.beginPath();
  c.moveTo(8, -38); c.lineTo(4, -48); c.lineTo(2, -38); c.closePath();
  c.fill();
  strokeOutline(c, '#e9e4f2', 1.8);
  // yeux
  c.fillStyle = '#0d0a14';
  c.beginPath();
  c.arc(-5, -29, 2.5, 0, Math.PI * 2);
  c.arc(5, -29, 2.5, 0, Math.PI * 2);
  c.fill();

  if (accessory === 'cap') {
    c.fillStyle = '#2f9e6b';
    c.beginPath();
    c.arc(0, -33, 14.5, Math.PI * 0.85, Math.PI * 2.15);
    c.fill();
    strokeOutline(c, '#2f9e6b', 1.8);
  } else if (accessory === 'hat') {
    c.fillStyle = '#caa25a';
    c.beginPath();
    c.ellipse(0, -40, 18, 4, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 1.8);
  }
  drawPremiumAccessory(c, accessory, -28, 14);
}

