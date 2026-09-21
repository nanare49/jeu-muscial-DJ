# Jeu musical DJ — comment le code est organisé

Ce document explique comment le projet est rangé, pour que n'importe qui
qui sait coder puisse s'y retrouver et modifier une partie précise sans
avoir à tout lire.

Le jeu a deux moitiés bien séparées :

- **`server.js` + `server/`** : le serveur Node.js (salles, joueurs, mini-jeu,
  effets lumineux, DJ...). Tourne sur Render, en Node/Express/Socket.io.
- **`public/`** : tout ce qui est envoyé au navigateur (le jeu lui-même :
  affichage, déplacement, effets visuels, chat, lecteur vidéo...).

Les deux communiquent uniquement par messages Socket.io (voir la liste des
évènements plus bas) — jamais d'appel direct entre le code serveur et le
code client.

## Démarrer le projet en local

```
npm install
npm start
```

Puis ouvrir http://localhost:3000 : une salle est créée automatiquement.

## Côté serveur : `server/`

`server.js` à la racine est volontairement tout petit (une cinquantaine de
lignes) : il ne contient presque aucune logique de jeu. Son seul rôle est de
construire chaque module du dossier `server/` et de les relier entre eux,
dans l'ordre où ils dépendent les uns des autres. Pour changer un
comportement du jeu, c'est presque toujours dans un des fichiers de
`server/` qu'il faut aller, jamais dans `server.js`.

| Fichier | Rôle | Dépend de |
|---|---|---|
| `server/config.js` | Toutes les constantes de réglage (durées, rayons, couleurs, prix boutique...) et quelques petites fonctions pures (`clamp`, `pick`, `isHexColor`...). Aucune dépendance vers les autres modules. | — |
| `server/profiles.js` | Profils persistants des joueurs (XP, pièces, objets achetés), lus/écrits dans `data/profiles.json`. | `config` |
| `server/rooms.js` | La liste des salles actives (`Map`) et leur cycle de vie (création, nettoyage à la fermeture). | `config` |
| `server/lightEffects.js` | Validation d'un état d'effets lumineux envoyé par le DJ (`sanitizeLightEffects`), pour ne jamais renvoyer une valeur hors bornes aux autres joueurs. | `config` |
| `server/ambiance.js` | La "régie automatique" : effets lumineux et "drops" simulés qui changent tout seuls quand le DJ active le mode auto. | `config`, `rooms`, Socket.io (`io`) |
| `server/minigame.js` | Le mini-jeu de ramassage d'objets sur la piste : objets bonus/malus, cases disco, cycle d'un round (décompte → actif → fin). | `config`, `rooms`, `profiles`, `ambiance` |
| `server/djQueue.js` | La rotation obligatoire de la main DJ (file d'attente, passage de main, récompense de fin de passage). | `profiles`, `minigame` |
| `server/uploads.js` | Réception des fichiers audio/vidéo importés par un DJ (route `POST /upload-track`). | `config` (Express `app`) |
| `server/socketHandlers.js` | Tous les évènements reçus des clients (`join-room`, `move`, `play-video`, `set-light-effects`...) — le seul fichier qui connaît le détail du protocole temps réel. S'appuie sur tous les modules ci-dessus. | tous les modules ci-dessus |

### Pourquoi ce découpage (le "pourquoi" pour un pro qui découvre le code)

Node.js ne partage pas automatiquement les variables entre fichiers (chaque
`require()` est isolé), contrairement à un simple script de navigateur. Le
choix ici a donc été : chaque module exporte une **fonction fabrique**
(`module.exports = function createXxx({ ...dépendances... }) { ...; return
{ ...fonctions publiques... }; }`). `server.js` appelle ces fabriques dans
le bon ordre et leur passe ce dont elles ont besoin (par exemple `minigame`
a besoin de `profiles` pour créditer des pièces, donc `server.js` construit
`profiles` avant `minigame` et le lui donne en paramètre).

Un cas particulier : les effets lumineux automatiques et les "drops"
simulés (dans `ambiance.js`) s'appellent l'un l'autre en boucle (un drop
redéclenche un nouvel effet auto, qui peut à son tour préparer le prochain
drop). Plutôt que de créer deux fichiers qui dépendent circulairement l'un
de l'autre, les deux vivent ensemble dans `ambiance.js` : c'est plus simple
à suivre qu'une dépendance circulaire entre fichiers.

**Aucune ligne de logique du jeu n'a été réécrite pendant cette
réorganisation** — chaque fonction a été déplacée telle quelle dans son
nouveau fichier, seule leur façon d'être reliées entre elles a changé.

## Côté client : `public/`

- `public/index.html` : juste le squelette HTML (les panneaux d'interface,
  le `<canvas>` du jeu) et la liste des scripts à charger. Très court,
  volontairement.
- `public/css/style.css` : tous les styles, dans un seul fichier séparé du HTML.
- `public/js/` : le code du jeu, réparti en **28 fichiers numérotés**,
  chargés dans cet ordre précis (l'ordre compte : un fichier peut utiliser
  une fonction définie plus loin, tant qu'elle n'est appelée qu'au moment
  du jeu — c'est-à-dire après que tous les fichiers ont fini de se
  charger — mais pas l'inverse pour du code exécuté immédiatement).

| Fichier | Contenu |
|---|---|
| `01-bootstrap.js` | Canvas, redimensionnement, connexion Socket.io, état de jeu global partagé |
| `02-avatar-select-screen.js` | Écran de sélection d'avatar avant d'entrer dans la salle |
| `03-socket-events-core.js` | Connexion/déconnexion, synchronisation des autres joueurs |
| `04-minigame-items.js` | Mini-jeu de ramassage d'objets et cases disco (côté affichage) |
| `05-light-fx-controls-ui.js` | Panneau DJ "Effets lumineux" |
| `06-ui-panels.js` | Bulles, poses, accessoires, profil, boutique |
| `07-movement.js` | Déplacement au clavier |
| `08-decor-background.js` | Fond de scène, éclairage ambiant, écrans LED géants |
| `09-stage-props.js` | Podium DJ, platines, barrière |
| `10-truss.js` | Structure métallique façon festival (lyres, lasers, canons CO2) |
| `11-decor-mainstages.js` | Décor spécifique Temple / Arena / Electro / grande roue |
| `12-decor-circus-performers.js` | Décor Cirque et ses petits numéros |
| `13-render-helpers.js` | Utilitaires de dessin partagés |
| `14-player-render-core.js` | Rendu commun à tous les joueurs |
| `15` à `20` — `avatar-*.js` | Un fichier par type d'avatar (humain, robot, alien, fantôme, dragon, blob) |
| `21-main-loop.js` | La boucle de rendu principale (`loop()`) |
| `22-light-effects-basic.js` | Laser, spots LED, boules de feu, étincelles, fumée |
| `23-light-effects-truss-beams.js` | Faisceaux animés de la structure, effet flash |
| `24-dj-character.js` | Rendu du DJ sur scène |
| `25-chat-and-bubbles.js` | Chat texte et bulles de dialogue |
| `26-music-youtube.js` | Lecture YouTube/fichier importé, contrôles |
| `27-audio-analysis.js` | Analyse audio réelle (Web Audio API) |
| `28-reactive-auto-vj.js` | Régie automatique pilotée par le son réel |

### Pourquoi ce découpage

Contrairement au serveur, un navigateur qui charge plusieurs balises
`<script src="...">` classiques (pas de type `module`) exécute tous ces
fichiers dans **un seul et même espace de variables partagé** — exactement
comme s'ils avaient été collés bout à bout. Le découpage a donc pu se
faire par simple **decoupe mécanique** du fichier original, sans rien
réécrire : chaque fichier est un bloc de lignes contiguës de l'ancien
script, dans le même ordre. C'est pour ça que les fichiers sont numérotés :
l'ordre de chargement dans `index.html` doit rester exactement celui-là.

## Résumé pour trouver rapidement quoi modifier

- **Changer une durée, un prix, une couleur par défaut, un rayon...** →
  `server/config.js`.
- **Changer une règle du mini-jeu (objets, cases disco, effets bonus/malus)**
  → `server/minigame.js` (logique) et `public/js/04-minigame-items.js`
  (affichage).
- **Changer la rotation DJ / la file d'attente** → `server/djQueue.js`.
- **Ajouter/modifier un évènement Socket.io** → `server/socketHandlers.js`
  côté serveur, et le fichier `public/js/0X-*.js` concerné côté client.
- **Changer un décor, un effet lumineux, une animation** → le fichier
  `public/js/` correspondant (voir le tableau ci-dessus).
- **Changer les styles (couleurs d'interface, mise en page des panneaux)**
  → `public/css/style.css`.
