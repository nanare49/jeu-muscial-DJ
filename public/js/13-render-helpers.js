// 13-render-helpers.js
// Petits utilitaires de dessin partagés : rectangles arrondis, contours, dégradés, tubes de membres.
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  traceRoundRect(c, x, y, w, h, r);
}

// trace un rectangle arrondi SANS effacer le tracé en cours (utile pour dessiner
// plusieurs formes — ex: les deux jambes — avant un seul remplissage commun)
function traceRoundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// --- style "illustration vectorielle plate" : contour net + membres en volume ---
// Applique un contour sombre net sur la forme qui vient d'être remplie (le
// chemin est encore actif juste après un c.fill()), façon flat design avec
// un trait bien visible autour de chaque forme.
function strokeOutline(c, baseColor, width) {
  c.strokeStyle = shadeColor(baseColor, -42);
  c.lineWidth = width || 2.5;
  c.lineJoin = 'round';
  c.stroke();
}

// Dessine un membre (bras, jambe, tentacule, queue...) en "tube" avec contour,
// au lieu d'un simple bâton : un trait large sombre dessous, un trait de la
// couleur du personnage par-dessus, un peu plus fin — même geste que les bras
// dessinés à la main dans une illustration vectorielle.
function drawLimbTube(c, x1, y1, x2, y2, width, color) {
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = shadeColor(color, -42);
  c.lineWidth = width + 4;
  c.stroke();
  c.beginPath();
  c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

// Petite touche de lumière plate, façon illustration vectorielle, posée sur
// une forme déjà remplie (torse, tête...) sans dégradé complexe.
function drawFlatHighlight(c, x, y, w, h, alpha) {
  c.fillStyle = `rgba(255,255,255,${alpha != null ? alpha : 0.16})`;
  c.beginPath();
  c.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  c.fill();
}

// Dégradé doux (clair en haut, plus sombre en bas) pour donner du volume à un
// torse/rectangle au lieu d'un simple aplat de couleur — look plus "rendu".
function linearBodyGradient(c, x, y, w, h, color) {
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shadeColor(color, 20));
  g.addColorStop(1, shadeColor(color, -14));
  return g;
}

// Dégradé radial (clair en haut-gauche, plus sombre sur les bords) pour les
// formes rondes (têtes, corps de fantôme/blob...), même intention en plus doux.
function radialBodyGradient(c, cx, cy, r, color) {
  const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r * 1.15);
  g.addColorStop(0, shadeColor(color, 26));
  g.addColorStop(1, shadeColor(color, -16));
  return g;
}

// --- lissage des poses : au lieu de sauter instantanément à la valeur cible
// dès qu'un joueur change de mouvement (danse, saut...), chaque valeur glisse
// doucement vers sa cible d'une frame à l'autre, pour une animation fluide
// plutôt que des poses qui "claquent" d'un état à l'autre. `state` est un
// objet persistant propre à chaque joueur (ré-utilisé d'une frame sur l'autre).
function smoothMotion(state, target, t) {
  if (state.lastT === undefined) {
    Object.assign(state, target);
    state.lastT = t;
    return state;
  }
  const dt = Math.max(0, Math.min(64, t - state.lastT));
  state.lastT = t;
  const alpha = 1 - Math.exp(-dt / 110);
  for (const key in target) {
    if (state[key] === undefined) state[key] = target[key];
    else state[key] += (target[key] - state[key]) * alpha;
  }
  return state;
}

