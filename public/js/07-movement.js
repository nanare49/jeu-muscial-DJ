// 07-movement.js
// Déplacement du joueur au clavier (flèches).
// --- déplacement ---
const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup', e => { keys[e.key] = false; });
let myX = 0.5, myY = 0.6;
function updateMovement() {
  if (!avatarConfirmed) return;

  // immobilisé (platine vinyle ramassée) : on ne bouge pas du tout, on danse sur place
  if (myStatusEffect && myStatusEffect.type === 'frozen') {
    if (selfId && players[selfId]) { players[selfId].x = myX; players[selfId].y = myY; }
    return;
  }

  let speed = 0.006;
  if (myStatusEffect && myStatusEffect.type === 'speed') speed *= 1.7;   // basket ramassée
  if (myStatusEffect && myStatusEffect.type === 'slowed') speed *= 0.45; // carte VIP d'un adversaire

  // touches inversées (seringue ramassée)
  const inverted = myStatusEffect && myStatusEffect.type === 'inverted';
  const leftKey = inverted ? 'ArrowRight' : 'ArrowLeft';
  const rightKey = inverted ? 'ArrowLeft' : 'ArrowRight';
  const upKey = inverted ? 'ArrowDown' : 'ArrowUp';
  const downKey = inverted ? 'ArrowUp' : 'ArrowDown';

  if (keys[leftKey]) myX -= speed;
  if (keys[rightKey]) myX += speed;
  if (keys[upKey]) myY -= speed;
  if (keys[downKey]) myY += speed;
  myX = Math.max(0.05, Math.min(0.95, myX));
  myY = Math.max(stageMinY(), Math.min(0.9, myY));
  if (selfId && players[selfId]) { players[selfId].x = myX; players[selfId].y = myY; }
  socket.emit('move', { x: myX, y: myY });
}
setInterval(updateMovement, 50);

