// server/profiles.js
// Profils persistants des joueurs (XP, pièces, objets achetés).
// Identifiés par un "token" généré et gardé par chaque navigateur (localStorage),
// PAS par un vrai compte : quelqu'un qui copie son token sur un autre appareil
// partagerait le même profil, mais il n'y a pas de mot de passe à retenir.
// Sauvegardés dans un simple fichier JSON : ça survit aux reconnexions et aux
// redémarrages du serveur, mais pas à un redéploiement sur un hébergeur dont le
// disque est réinitialisé à chaque déploiement (c'est le cas sur Render).
const fs = require('fs');
const path = require('path');

module.exports = function createProfiles({ config }) {
  const PROFILES_FILE = path.join(__dirname, '..', 'data', 'profiles.json');
  let profiles = {};
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Impossible de lire les profils sauvegardés :', e.message);
    profiles = {};
  }
  let profileSaveScheduled = false;
  function scheduleSaveProfiles() {
    if (profileSaveScheduled) return;
    profileSaveScheduled = true;
    setTimeout(() => {
      profileSaveScheduled = false;
      try {
        fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
      } catch (e) {
        console.error('Impossible de sauvegarder les profils :', e.message);
      }
    }, 2000);
  }

  const XP_PER_LEVEL = 100;
  function levelForXp(xp) {
    return 1 + Math.floor(xp / XP_PER_LEVEL);
  }

  function isValidToken(token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token);
  }

  function getOrCreateProfile(token) {
    if (!profiles[token]) {
      profiles[token] = {
        xp: 0,
        coins: 0,
        ownedItems: []
      };
    }
    return profiles[token];
  }

  function publicProfile(token) {
    const p = getOrCreateProfile(token);
    return {
      xp: p.xp,
      coins: p.coins,
      level: levelForXp(p.xp),
      xpIntoLevel: p.xp % XP_PER_LEVEL,
      xpPerLevel: XP_PER_LEVEL,
      ownedItems: p.ownedItems
    };
  }

  function canUseAccessory(token, accessoryId) {
    if (config.freeAccessories.includes(accessoryId)) return true;
    const item = config.shopItemsById.get(accessoryId);
    if (!item || item.slot !== 'accessory') return false;
    const profile = getOrCreateProfile(token);
    return profile.ownedItems.includes(accessoryId);
  }

  return {
    XP_PER_LEVEL,
    scheduleSaveProfiles,
    levelForXp,
    isValidToken,
    getOrCreateProfile,
    publicProfile,
    canUseAccessory
  };
};
