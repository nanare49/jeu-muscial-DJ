// 16-avatar-robot.js
// Avatar « Robot ».
// --- avatar "Robot" : corps carré, une antenne, un œil rond ---
function drawRobotBody(c, move, accessory, color, isMe, t, motionState) {
  const { armLift, bob, sway, legSpread } = smoothMotion(motionState || {}, motionFor(move, t), t);
  c.translate(sway, -bob);
  drawShadow(c, sway, bob);

  // jambes bloc
  c.fillStyle = '#3a3a44';
  c.beginPath();
  traceRoundRect(c, -13 - (legSpread - 6), 18, 10, 18, 3);
  traceRoundRect(c, 3 + (legSpread - 6), 18, 10, 18, 3);
  c.fill();
  strokeOutline(c, '#3a3a44', 2.2);

  // corps : plastron avec plaques distinctes (vêtement du robot), pas un
  // simple aplat — dégradé pour le volume + lignes de jointure
  c.fillStyle = linearBodyGradient(c, -19, -16, 38, 38, color);
  roundRect(c, -19, -16, 38, 38, 8);
  c.fill();
  strokeOutline(c, color, 2.6);
  c.strokeStyle = shadeColor(color, -38);
  c.lineWidth = 1.6;
  roundRect(c, -12, -10, 24, 26, 5);
  c.stroke();
  c.beginPath();
  c.moveTo(-19, -1); c.lineTo(19, -1);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.lineWidth = 2;
  roundRect(c, -16, -13, 14, 32, 5);
  c.stroke();
  drawFlatHighlight(c, -7, -6, 8, 13, 0.14);

  // bras (blocs qui se lèvent)
  const armY = -6 - armLift * 22;
  c.fillStyle = '#3a3a44';
  c.beginPath();
  traceRoundRect(c, -30, armY, 10, 20, 4);
  traceRoundRect(c, 20, armY, 10, 20, 4);
  c.fill();
  strokeOutline(c, '#3a3a44', 2.2);

  // tête
  c.fillStyle = '#3a3a44';
  roundRect(c, -16, -46, 32, 26, 8);
  c.fill();
  strokeOutline(c, '#3a3a44', 2.4);
  // antenne
  c.strokeStyle = '#3a3a44';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(0, -46); c.lineTo(0, -56);
  c.stroke();
  c.fillStyle = color;
  c.beginPath();
  c.arc(0, -58, 4, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, color, 1.8);
  // œil
  c.fillStyle = color;
  c.beginPath();
  c.arc(0, -33, 8, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, color, 2);
  c.fillStyle = '#0d0a14';
  c.beginPath();
  c.arc(0, -33, 4, 0, Math.PI * 2);
  c.fill();

  if (accessory === 'cap' || accessory === 'hat') {
    const capColor = accessory === 'cap' ? '#2f9e6b' : '#caa25a';
    c.fillStyle = capColor;
    roundRect(c, -18, -52, 36, 6, 3);
    c.fill();
    strokeOutline(c, capColor, 1.8);
  }
  drawPremiumAccessory(c, accessory, -33, 16);
}

