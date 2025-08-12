// src/api/embarcadorRoutes.js
const express = require('express');
const router = express.Router();
const embarcadorController = require('../controllers/embarcadorController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

router.get('/', authMiddleware, isAdmin, embarcadorController.getAllEmbarcadores);

module.exports = router;