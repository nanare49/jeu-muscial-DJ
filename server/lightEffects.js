// server/lightEffects.js
// Validation/nettoyage d'un état d'effets lumineux envoyé par un client
// (cf. l'évènement socket 'set-light-effects') : jamais de valeur hors bornes
// ou de type inattendu envoyée aux autres joueurs, quoi qu'envoie le DJ.
module.exports = function createLightEffects({ config }) {
  const { clamp, isHexColor, validLaserStyles } = config;

  function sanitizeLightEffects(payload, previous) {
    const power = Number(payload.power);
    const speed = Number(payload.speed);
    const laserIn = payload.laser || {};
    const laserCountRaw = Math.round(Number(laserIn.count));
    const sparksIn = payload.sparks || {};
    const sparksCountRaw = Math.round(Number(sparksIn.count));
    const sparksIntensity = Number(sparksIn.intensity);
    const fireballsIn = payload.fireballs || {};
    const validFireballsCounts = [2, 4, 6, 8];
    const fireballsCountRaw = Math.round(Number(fireballsIn.count));
    const smokeIn = payload.smoke || {};
    const validSmokeCounts = [1, 2, 3, 4, 5, 6, 7];
    const smokeCountRaw = Math.round(Number(smokeIn.count));
    return {
      flash: {
        on: !!(payload.flash && payload.flash.on),
        color: isHexColor(payload.flash && payload.flash.color) ? payload.flash.color : previous.flash.color
      },
      laser: {
        on: !!laserIn.on,
        color: isHexColor(laserIn.color) ? laserIn.color : previous.laser.color,
        count: Number.isFinite(laserCountRaw) ? clamp(laserCountRaw, 1, 8) : previous.laser.count,
        style: validLaserStyles.includes(laserIn.style) ? laserIn.style : previous.laser.style
      },
      fireballs: {
        on: !!fireballsIn.on,
        color: isHexColor(fireballsIn.color) ? fireballsIn.color : previous.fireballs.color,
        count: validFireballsCounts.includes(fireballsCountRaw) ? fireballsCountRaw : (previous.fireballs.count || 2)
      },
      sparks: {
        on: !!sparksIn.on,
        color: isHexColor(sparksIn.color) ? sparksIn.color : previous.sparks.color,
        count: Number.isFinite(sparksCountRaw) ? clamp(sparksCountRaw, 4, 10) : previous.sparks.count,
        intensity: Number.isFinite(sparksIntensity) ? clamp(sparksIntensity, 0, 1) : previous.sparks.intensity
      },
      ledbar: {
        on: !!(payload.ledbar && payload.ledbar.on),
        color: isHexColor(payload.ledbar && payload.ledbar.color) ? payload.ledbar.color : previous.ledbar.color
      },
      smoke: {
        on: !!smokeIn.on,
        color: isHexColor(smokeIn.color) ? smokeIn.color : (previous.smoke ? previous.smoke.color : '#cfd6e6'),
        count: validSmokeCounts.includes(smokeCountRaw) ? smokeCountRaw : (previous.smoke ? previous.smoke.count : 4)
      },
      power: Number.isFinite(power) ? clamp(power, 0, 1) : previous.power,
      speed: Number.isFinite(speed) ? clamp(speed, 0.3, 2.5) : previous.speed,
      autoMode: !!payload.autoMode
    };
  }

  return { sanitizeLightEffects };
};
