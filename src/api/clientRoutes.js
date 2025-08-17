// src/api/clientRoutes.js
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middlewares/authMiddleware');

// Rota protegida para o cliente buscar suas próprias operações
router.get('/operations', authMiddleware, clientController.getMyOperations);
router.get('/kpis', authMiddleware, clientController.getMyKpis);
router.get('/profile', authMiddleware, clientController.getMyProfile);

module.exports = router;