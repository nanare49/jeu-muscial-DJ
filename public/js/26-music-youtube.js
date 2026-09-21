// 26-music-youtube.js
// Lecture de musique : lien YouTube ou fichier importé, contrôles (pause/avance/recul/volume), synchronisation d'état, minuteur de piste.
// --- Musique : lien YouTube, ou fichier audio/vidéo importé (MP3, MP4...) ---
let ytPlayer = null;
let ytPlayerReady = false;
let ytVolume = parseInt(localStorage.getItem('ytVolume'), 10);
if (isNaN(ytVolume) || ytVolume < 0 || ytVolume > 100) ytVolume = 100;
document.getElementById('yt-volume').value = ytVolume;
document.getElementById('yt-volume-value').textContent = ytVolume;
let pendingVideo = null;       // dernier état reçu avant que le lecteur soit prêt
let currentLoadedVideoId = null;
let currentLoadedFileUrl = null;
let currentVideoState = null;  // dernier état connu (source, paused, positionSec, anchorAt, videoId|url)
const localTrackPlayer = document.getElementById('local-track-player');
localTrackPlayer.muted = true; // même politique que la vidéo YouTube : démarre muet, débloqué par le premier clic
localTrackPlayer.volume = ytVolume / 100;

// --- correction d'horloge (pour un top départ fiable même avec une heure système décalée) ---
let clockOffset = 0; // à ajouter à Date.now() pour estimer l'heure du serveur
function serverNow() { return Date.now() + clockOffset; }

function syncClock(attemptsLeft = 3) {
  const t0 = Date.now();
  socket.emit('time-sync', null, (serverTime) => {
    const rtt = Date.now() - t0;
    clockOffset = (serverTime + rtt / 2) - Date.now();
    if (attemptsLeft > 1) setTimeout(() => syncClock(attemptsLeft - 1), 300);
  });
}

function extractYoutubeId(url) {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

document.getElementById('youtube-launch-btn').addEventListener('click', () => {
  const url = document.getElementById('youtube-input').value.trim();
  const videoId = extractYoutubeId(url);
  if (!videoId) {
    alert('Lien YouTube non reconnu. Colle un lien du type https://www.youtube.com/watch?v=... ou https://youtu.be/...');
    return;
  }
  socket.emit('play-video', { videoId, title: url });
  socket.emit('chat', '📺 a lancé une vidéo YouTube');
});

// Import d'un fichier audio/vidéo local (MP3, MP4, WAV...) : envoyé au serveur
// qui le stocke temporairement et donne une URL, puis "top départ" commun comme
// pour un lien YouTube — sauf qu'ici, chaque navigateur ayant le vrai fichier,
// les effets lumineux automatiques peuvent suivre une vraie analyse du son
// (cf. ensureAudioGraph/updateRealMusicEnergy plus bas) au lieu du rythme simulé.
document.getElementById('track-file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusBox = document.getElementById('file-track-status');
  statusBox.textContent = '⏳ Import en cours...';
  try {
    const formData = new FormData();
    formData.append('track', file);
    formData.append('name', file.name);
    const res = await fetch('/upload-track', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusBox.textContent = '⚠️ ' + (data.error || "Import impossible.");
      return;
    }
    statusBox.textContent = '';
    socket.emit('play-file-track', { url: data.url, name: data.name });
    socket.emit('chat', '🎵 a lancé un morceau importé (' + data.name + ')');
  } catch (err) {
    statusBox.textContent = '⚠️ Import impossible (connexion).';
  } finally {
    e.target.value = ''; // permet de réimporter le même fichier plus tard si besoin
  }
});

function currentActualPosition(cv) {
  if (!cv) return 0;
  return cv.paused ? cv.positionSec : cv.positionSec + Math.max(0, serverNow() - cv.anchorAt) / 1000;
}

document.getElementById('yt-pause-btn').addEventListener('click', () => {
  if (!currentVideoState) return;
  const pos = currentActualPosition(currentVideoState);
  const goingToPause = !currentVideoState.paused;
  socket.emit('video-control', { action: goingToPause ? 'pause' : 'play', positionSec: pos });
});
document.getElementById('yt-back-btn').addEventListener('click', () => {
  if (!currentVideoState) return;
  const pos = Math.max(0, currentActualPosition(currentVideoState) - 10);
  socket.emit('video-control', { action: 'seek', positionSec: pos });
});
document.getElementById('yt-forward-btn').addEventListener('click', () => {
  if (!currentVideoState) return;
  const pos = currentActualPosition(currentVideoState) + 10;
  socket.emit('video-control', { action: 'seek', positionSec: pos });
});

socket.on('video-state', (cv) => applyVideoState(cv));

// Applique un état de lecture reçu du serveur : charge le morceau si besoin,
// se cale sur la bonne position, et joue ou met en pause selon le cas — que la
// source soit une vidéo YouTube ou un fichier importé. Recalcule toujours tout
// au moment de l'exécution (jamais figé à l'avance), ce qui évite les décalages
// si le lecteur n'était pas encore prêt.
function applyVideoState(cv) {
  currentVideoState = cv;
  document.getElementById('yt-pause-btn').textContent = cv.paused ? '▶ Lecture' : '⏸ Pause';

  const isFile = cv.source === 'file';
  document.getElementById('youtube-player-wrap').style.display = isFile ? 'none' : '';

  if (isFile) applyFileTrackState(cv);
  else applyYoutubeState(cv);

  updateTrackTimingUI(performance.now(), true);
}

// --- affichage du timing de la piste en cours (cadre "Musique & file DJ") ---
function formatTrackTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}
let lastTimingUIUpdate = 0;
function updateTrackTimingUI(now, force) {
  if (!force && now - lastTimingUIUpdate < 300) return;
  lastTimingUIUpdate = now;
  const titleEl = document.getElementById('track-timing-title');
  const fillEl = document.getElementById('track-timing-bar-fill');
  const elapsedEl = document.getElementById('track-timing-elapsed');
  const durationEl = document.getElementById('track-timing-duration');
  const cv = currentVideoState;
  if (!cv) {
    titleEl.textContent = 'Aucune musique en cours.';
    fillEl.style.width = '0%';
    elapsedEl.textContent = '0:00';
    durationEl.textContent = '--:--';
    return;
  }
  titleEl.textContent = (cv.paused ? '⏸ ' : '▶ ') + (cv.title || cv.videoId || cv.url || 'Musique');
  const elapsed = Math.max(0, currentActualPosition(cv));
  let duration = 0;
  if (cv.source === 'file') {
    duration = (localTrackPlayer && isFinite(localTrackPlayer.duration)) ? localTrackPlayer.duration : 0;
  } else if (ytPlayer && ytPlayerReady && typeof ytPlayer.getDuration === 'function') {
    try { duration = ytPlayer.getDuration() || 0; } catch (e) { duration = 0; }
  }
  const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  fillEl.style.width = pct + '%';
  elapsedEl.textContent = formatTrackTime(elapsed);
  durationEl.textContent = duration > 0 ? formatTrackTime(duration) : '--:--';
}

function applyFileTrackState(cv) {
  ytPlayer && ytPlayerReady && ytPlayer.pauseVideo(); // on quitte une éventuelle vidéo YouTube précédente

  const delay = cv.anchorAt - serverNow();
  const doApply = () => {
    const pos = Math.max(0, currentActualPosition(cv));
    const isNewTrack = cv.url !== currentLoadedFileUrl;
    if (isNewTrack) {
      currentLoadedFileUrl = cv.url;
      localTrackPlayer.src = cv.url;
      ensureAudioGraph();
      localTrackPlayer.currentTime = pos;
      const startPlayback = () => { if (!cv.paused) localTrackPlayer.play().catch(() => {}); };
      if (localTrackPlayer.readyState >= 1) startPlayback();
      else localTrackPlayer.addEventListener('loadedmetadata', startPlayback, { once: true });
      if (cv.paused) localTrackPlayer.pause();
    } else {
      if (Math.abs(localTrackPlayer.currentTime - pos) > 1.5) localTrackPlayer.currentTime = pos;
      if (cv.paused) localTrackPlayer.pause();
      else localTrackPlayer.play().catch(() => {});
    }
  };
  if (delay > 0) setTimeout(doApply, delay); else doApply();
}

function applyYoutubeState(cv) {
  localTrackPlayer.pause(); // on quitte un éventuel fichier importé précédent

  const delay = cv.anchorAt - serverNow(); // positif seulement pour un tout nouveau morceau (top départ futur)

  const doApply = () => {
    if (!ytPlayerReady) { pendingVideo = cv; return; }
    const pos = Math.max(0, currentActualPosition(cv));
    const isNewVideo = cv.videoId !== currentLoadedVideoId;

    if (isNewVideo) {
      currentLoadedVideoId = cv.videoId;
      ytPlayer.loadVideoById({ videoId: cv.videoId, startSeconds: pos });
      if (cv.paused) setTimeout(() => ytPlayer.pauseVideo(), 400);
    } else {
      ytPlayer.seekTo(pos, true);
      if (cv.paused) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
    }
  };

  if (delay > 0) setTimeout(doApply, delay); else doApply();
}

window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('youtube-player', {
    height: '100%', width: '100%',
    // on démarre TOUJOURS en muet : les navigateurs autorisent ça sans restriction,
    // contrairement au son automatique qui est bloqué tant que la personne n'a pas
    // encore interagi avec la page. Le bouton "Activer le son" débloque ensuite.
    playerVars: { autoplay: 1, playsinline: 1, controls: 0, mute: 1 },
    events: {
      onReady: () => {
        ytPlayerReady = true;
        ytPlayer.setVolume(ytVolume);
        refreshUnmuteButtonVisibility();
        if (pendingVideo) {
          const cv = pendingVideo;
          pendingVideo = null;
          applyVideoState(cv); // recalcule tout depuis zéro, maintenant que le lecteur est prêt
        }
      },
      onStateChange: (event) => {
        // quand la vidéo se termine chez le DJ actuel : on solde toujours son
        // passage (notes -> XP/pièces), et en plus, si le mode file d'attente
        // est actif, on passe automatiquement la main à la personne suivante
        if (event.data === YT.PlayerState.ENDED && selfId === myDjId) {
          socket.emit('video-ended');
        }
      }
    }
  });
};
const ytScript = document.createElement('script');
ytScript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytScript);

// Sous Safari (surtout iPhone/iPad), appeler unMute() ne suffit pas toujours
// à débloquer réellement le son d'une iframe tierce (YouTube) : le message
// part bien, mais Safari peut malgré tout garder la lecture muette selon la
// politique autoplay de CE cadre précis. Se fier à "on a tenté unMute() donc
// on cache le bouton" était le vrai bug remonté : le bouton disparaissait dès
// la première interaction anodine sur la page (ex: valider son avatar, AVANT
// même qu'un morceau ne joue), donc quand le son restait coupé au moment où
// la musique démarrait vraiment, il n'y avait plus aucun moyen de réessayer.
// On vérifie donc l'état RÉEL régulièrement (isMuted()) et on ne cache le
// bouton que quand le son est effectivement actif.
function refreshUnmuteButtonVisibility() {
  const btn = document.getElementById('yt-unmute-btn');
  let stillMuted = false;
  if (ytPlayer && ytPlayerReady && typeof ytPlayer.isMuted === 'function') {
    try { stillMuted = !!ytPlayer.isMuted(); } catch (e) {}
  }
  if (localTrackPlayer && localTrackPlayer.muted) stillMuted = true;
  btn.classList.toggle('hidden', !stillMuted);
}

function unmutePlayer() {
  if (ytPlayer && ytPlayerReady) {
    ytPlayer.unMute();
    ytPlayer.setVolume(ytVolume);
    // Safari n'autorise le son d'une iframe multimédia que si l'appel se
    // produit bien PENDANT le geste utilisateur d'origine — un simple
    // unMute() ne suffit pas toujours : on relance aussi la lecture à ce
    // moment précis, ce qui débloque le son de façon plus fiable même quand
    // Chrome n'en avait pas besoin.
    if (currentVideoState && currentVideoState.source !== 'file' && !currentVideoState.paused) {
      try { ytPlayer.playVideo(); } catch (e) {}
    }
  }
  localTrackPlayer.muted = false;
  if (currentVideoState && currentVideoState.source === 'file' && !currentVideoState.paused) {
    localTrackPlayer.play().catch(() => {});
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  // L'appel à unMute() passe par un postMessage vers l'iframe YouTube (autre
  // origine) : la réponse n'est pas immédiate, donc on vérifie l'état réel un
  // instant après plutôt que de supposer que ça a marché.
  refreshUnmuteButtonVisibility();
  setTimeout(refreshUnmuteButtonVisibility, 250);
  setTimeout(refreshUnmuteButtonVisibility, 900);
}
document.getElementById('yt-unmute-btn').addEventListener('click', unmutePlayer);
// Tentative en plus : la toute première interaction n'importe où sur la page
// essaie aussi de débloquer le son. Safari (notamment sur iPhone/iPad) ne
// considère PAS qu'un simple glissement tactile (ex: déplacer un curseur
// comme celui du volume) déclenche un évènement "click" — seuls des
// évènements comme touchstart/pointerdown le font — donc se limiter à
// 'click' laissait le son coupé pour quiconque commençait par toucher un
// curseur plutôt que de taper un bouton. Ce n'est qu'une TENTATIVE en plus :
// le bouton "Activer le son" (cf. refreshUnmuteButtonVisibility) reste
// affiché tant que le son n'est pas confirmé réellement actif, pour que la
// personne puisse toujours réessayer explicitement si ça n'a pas suffi.
['click', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, unmutePlayer, { once: true, passive: true });
});
// Vérification périodique : couvre le cas où le son se coupe de nouveau tout
// seul (ex: nouvelle vidéo chargée) sans qu'aucun des évènements ci-dessus ne
// se redéclenche.
setInterval(refreshUnmuteButtonVisibility, 1500);

document.getElementById('yt-volume').addEventListener('input', (e) => {
  ytVolume = parseInt(e.target.value, 10);
  document.getElementById('yt-volume-value').textContent = ytVolume;
  localStorage.setItem('ytVolume', ytVolume);
  if (ytPlayer && ytPlayerReady) ytPlayer.setVolume(ytVolume);
  localTrackPlayer.volume = ytVolume / 100;
  // Chaque réglage de volume retente aussi le déblocage du son (pas juste le
  // tout premier, cf. commentaire au-dessus de unmutePlayer) : si Safari a
  // ignoré la première tentative, la personne qui bouge le curseur du volume
  // pour essayer d'entendre quelque chose redéclenche l'essai à chaque fois.
  unmutePlayer();
});
// Filet de sécurité dédié : si la toute première chose que la personne fait
// sur la page est de régler le volume (très probable vu le contrôle), ce
// geste-là doit lui-même débloquer le son sous Safari — cf. commentaire
// au-dessus de unmutePlayer(). Sans ce filet, toucher/glisser le curseur ne
// déclenche déjà l'un des évènements globaux ci-dessus, mais on s'assure
// ici explicitement que le curseur de volume ne fait jamais exception.
['pointerdown', 'touchstart'].forEach(evt => {
  document.getElementById('yt-volume').addEventListener(evt, unmutePlayer, { passive: true });
});

