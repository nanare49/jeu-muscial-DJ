// Serveur avec plusieurs salles indépendantes + lecture vidéo YouTube synchronisée.
// Aucune connexion (Spotify ou autre) n'est nécessaire : n'importe qui colle un
// lien YouTube et tout le monde dans la salle regarde/écoute au même moment.
//
// Ce fichier est juste le point d'entrée : il construit chaque module du
// dossier server/ (voir server/README.md pour le détail de qui dépend de
// qui) et les relie entre eux, dans l'ordre de leurs dépendances. Toute la
// logique du jeu vit dans ces modules, pas ici.
//
// Démarrage :
//   npm install
//   npm start
// Puis ouvrir http://localhost:3000 : une nouvelle salle est créée automatiquement
// et son lien s'affiche pour être partagé.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./server/config');
const createProfiles = require('./server/profiles');
const createRooms = require('./server/rooms');
const createLightEffects = require('./server/lightEffects');
const createAmbiance = require('./server/ambiance');
const createMinigame = require('./server/minigame');
const createDjQueue = require('./server/djQueue');
const registerUploads = require('./server/uploads');
const registerSocketHandlers = require('./server/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- fichiers audio/vidéo importés par un DJ (upload + service statique) ---
registerUploads({ app, config });

// --- construction des modules, dans l'ordre de leurs dépendances ---
const profiles = createProfiles({ config });
const roomsModule = createRooms({ config });
const lightEffects = createLightEffects({ config });
const ambiance = createAmbiance({ io, rooms: roomsModule.rooms, config });
const minigame = createMinigame({ io, rooms: roomsModule.rooms, config, profiles, ambiance });
const djQueue = createDjQueue({ io, profiles, minigame });

// --- branchement des évènements socket.io ---
registerSocketHandlers({ io, rooms: roomsModule, config, profiles, minigame, djQueue, lightEffects, ambiance });

server.listen(config.PORT, () => {
  console.log(`Serveur prêt sur http://localhost:${config.PORT}`);
});
