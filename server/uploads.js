// server/uploads.js
// Réception des fichiers audio/vidéo importés par un DJ (MP3, MP4, WAV...),
// en alternative au lien YouTube : sert les fichiers déjà stockés sous
// /tracks/, et reçoit les nouveaux imports via POST /upload-track.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

module.exports = function registerUploads({ app, config }) {
  const { TRACKS_DIR, MAX_TRACK_SIZE_BYTES, ALLOWED_TRACK_MIMETYPES } = config;

  app.use('/tracks', express.static(TRACKS_DIR));

  const trackUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, TRACKS_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
        cb(null, crypto.randomBytes(12).toString('hex') + ext);
      }
    }),
    limits: { fileSize: MAX_TRACK_SIZE_BYTES },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_TRACK_MIMETYPES.has(file.mimetype))
  });

  app.post('/upload-track', (req, res) => {
    trackUpload.single('track')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (30 Mo max).' : "Import du fichier impossible.";
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: 'Format non reconnu (fichier audio ou vidéo attendu).' });
      res.json({
        url: '/tracks/' + req.file.filename,
        name: String(req.body && req.body.name || req.file.originalname || 'Morceau importé').slice(0, 100)
      });
    });
  });
};
