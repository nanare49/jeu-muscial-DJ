// 20-avatar-blob.js
// Avatar « Blob ».
// --- avatar "Blob" : rond, tentacules, un œil ---
function drawBlobBody(c, move, accessory, color, isMe, t, motionState) {
  const rawBobBase = Math.abs(Math.sin(t / 500)) * 4;
  const rawExtra = move === 'jump' ? Math.abs(Math.sin(t / 200)) * 16
    : move === 'hands_up' ? Math.abs(Math.sin(t / 260)) * 6
    : (move === 'dance1' || move === 'dance2') ? Math.abs(Math.sin(t / 280)) * 8 : 0;
  const rawSway = (move === 'dance1' || move === 'dance2') ? Math.sin(t / 300) * 12 : Math.sin(t / 750) * 2;
  const { bobBase, extra, sway } = smoothMotion(motionState || {}, { bobBase: rawBobBase, extra: rawExtra, sway: rawSway }, t);
  const squish = 1 - Math.min(0.15, (bobBase + extra) / 60);
  c.translate(sway, -(bobBase + extra));

  c.save();
  c.translate(-sway, bobBase + extra);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(0, 30, 18, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // tentacules (tube avec contour)
  c.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.moveTo(i * 10, 14);
    c.quadraticCurveTo(i * 14, 24 + Math.sin(t / 300 + i) * 4, i * 8, 30 + Math.sin(t / 300 + i) * 3);
    c.strokeStyle = shadeColor(color, -42);
    c.lineWidth = 8;
    c.stroke();
    c.beginPath();
    c.moveTo(i * 10, 14);
    c.quadraticCurveTo(i * 14, 24 + Math.sin(t / 300 + i) * 4, i * 8, 30 + Math.sin(t / 300 + i) * 3);
    c.strokeStyle = color;
    c.lineWidth = 5;
    c.stroke();
  }

  // corps rond (légèrement écrasé au sol quand il saute)
  c.save();
  c.scale(1, squish);
  c.fillStyle = radialBodyGradient(c, -5, -12 / squish, 22, color);
  c.beginPath();
  c.arc(0, -4 / squish, 20, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, color, 2.6 / squish);
  // bandana, comme un vêtement bien distinct posé sur le corps rond
  const bandanaTone = shadeColor(color, -36);
  c.fillStyle = bandanaTone;
  c.beginPath();
  c.ellipse(0, -14 / squish, 19.5, 5.5, 0, Math.PI * 0.98, Math.PI * 2.02);
  c.fill();
  strokeOutline(c, bandanaTone, 1.6);
  drawFlatHighlight(c, -7, -12 / squish, 5, 7 / squish, 0.16);
  c.restore();

  // œil unique
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(0, -8, 9, 0, Math.PI * 2);
  c.fill();
  strokeOutline(c, '#fff', 2);
  c.fillStyle = '#0d0a14';
  c.beginPath();
  c.arc(0, -8, 4.5, 0, Math.PI * 2);
  c.fill();

  if (accessory === 'cap') {
    c.fillStyle = '#2f9e6b';
    c.beginPath();
    c.arc(0, -20, 13, Math.PI * 0.9, Math.PI * 2.1);
    c.fill();
    strokeOutline(c, '#2f9e6b', 1.8);
  } else if (accessory === 'hat') {
    c.fillStyle = '#caa25a';
    c.beginPath();
    c.ellipse(0, -24, 17, 4, 0, 0, Math.PI * 2);
    c.fill();
    strokeOutline(c, '#caa25a', 1.8);
  }
  drawPremiumAccessory(c, accessory, -8, 18);
}

