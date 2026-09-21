// 27-audio-analysis.js
// Analyse audio réelle (Web Audio API) d'un fichier importé : détection des graves/kicks pour piloter la régie automatique.
// --- analyse audio réelle d'un fichier importé --------------------------------
// Un fichier joué via <audio> est, contrairement à l'iframe YouTube, accessible
// à l'API Web Audio (même origine) : on peut donc en tirer une vraie mesure du
// niveau des graves en direct, au lieu du rythme simulé utilisé pour YouTube
// (cf. le commentaire équivalent côté serveur, sur MUSIC_PULSE_BPM_MIN).
let audioCtx = null;
let audioAnalyser = null;
let audioDataArray = null;
let audioGraphReady = false;
let audioBassBinCount = 1; // nombre de "cases" du spectre couvrant la zone grave/kick (~20-220 Hz)
let audioMidBinStart = 1, audioMidBinEnd = 2; // cases couvrant la zone médium/mélodie (~300-3000 Hz)
let realMusicEnergy = 0;   // 0..1, mis à jour en continu tant qu'un fichier joue
let realMidEnergy = 0;     // 0..1, énergie de la zone médium (mélodie/lead), pour faire bouger les lasers
let bassRunningAvg = 0;
let lastKickAt = 0;        // timestamp (performance.now()) du dernier kick détecté
let lastKickStrength = 0;  // 0..1, force du dernier kick détecté
let lastFlashKickAt = 0;   // dernier kick ayant effectivement déclenché un flash (cf. FLASH_MIN_INTERVAL_MS)
const KICK_THRESHOLD = 0.32;
const KICK_DEBOUNCE_MS = 140; // évite de compter deux fois le même coup de grosse caisse
// Un kick sur deux (ou trois) suffit à faire vivre les lumières ; le flash
// plein écran, lui, ne redéclenche jamais plus vite que ça — sécurité
// photosensibilité, indépendante de la fréquence réelle des kicks détectés.
const FLASH_MIN_INTERVAL_MS = 340; // ~2,9 flashs/s max, sous le seuil de 3/s

function ensureAudioGraph() {
  if (audioGraphReady) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(localTrackPlayer);
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 2048; // résolution fine dans les graves (cf. audioBassBinCount)
    audioAnalyser.smoothingTimeConstant = 0.35;
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
    source.connect(audioAnalyser);
    audioAnalyser.connect(audioCtx.destination);
    // largeur d'une case du spectre = sampleRate / fftSize : on en déduit combien
    // de cases couvrent la zone grave/kick (~20-220 Hz) et la zone médium/mélodie
    // (~300-3000 Hz, là où vivent la plupart des mélodies/leads), quel que soit
    // le taux d'échantillonnage réel du contexte (souvent 44100 ou 48000 Hz).
    const binHz = audioCtx.sampleRate / audioAnalyser.fftSize;
    audioBassBinCount = Math.max(2, Math.round(220 / binHz));
    audioMidBinStart = Math.max(audioBassBinCount, Math.round(300 / binHz));
    audioMidBinEnd = Math.min(audioDataArray.length, Math.max(audioMidBinStart + 4, Math.round(3000 / binHz)));
    audioGraphReady = true;
  } catch (e) {
    // Web Audio indisponible : tant pis, la piste retombera sur le rythme simulé.
  }
}

// Estime un niveau d'énergie 0..1 à partir du vrai son en train de jouer, avec
// un "coup" qui ressort quand les graves dépassent nettement leur moyenne
// récente (façon détection de kick), pour un pic net sur chaque temps plutôt
// qu'un simple niveau sonore plat. Calcule aussi l'énergie de la zone médium
// (mélodie/lead), utilisée pour faire bouger les lasers "au son de la mélodie"
// (cf. drawLaserEffect), et repère chaque kick détecté (cf. updateReactiveAutoVJ).
function updateRealMusicEnergy() {
  if (!audioAnalyser || localTrackPlayer.paused) {
    realMusicEnergy *= 0.9;
    realMidEnergy *= 0.9;
    return;
  }
  audioAnalyser.getByteFrequencyData(audioDataArray);
  let sum = 0;
  for (let i = 0; i < audioBassBinCount; i++) sum += audioDataArray[i];
  const bass = sum / audioBassBinCount / 255;
  bassRunningAvg += (bass - bassRunningAvg) * 0.06;
  const kick = Math.max(0, bass - bassRunningAvg * 1.15) * 2.4;
  const target = Math.max(bass * 0.45, Math.min(1, kick));
  realMusicEnergy += (target - realMusicEnergy) * 0.5;

  let midSum = 0;
  const midCount = Math.max(1, audioMidBinEnd - audioMidBinStart);
  for (let i = audioMidBinStart; i < audioMidBinEnd; i++) midSum += audioDataArray[i];
  const midTarget = Math.min(1, (midSum / midCount / 255) * 1.6);
  realMidEnergy += (midTarget - realMidEnergy) * 0.4;

  const now = performance.now();
  if (kick > KICK_THRESHOLD && now - lastKickAt > KICK_DEBOUNCE_MS) {
    lastKickAt = now;
    lastKickStrength = Math.min(1, kick);
  }
}

// Vrai que si un fichier importé est actuellement la source ET que l'analyse
// audio a pu démarrer (nécessite un premier clic sur la page, cf. unmutePlayer).
// Volontairement vrai même en pause : updateRealMusicEnergy fait alors retomber
// l'énergie à zéro tout seul, plutôt que de retomber sur le rythme simulé.
function isRealAudioActive() {
  return !!(currentVideoState && currentVideoState.source === 'file' && audioGraphReady);
}

