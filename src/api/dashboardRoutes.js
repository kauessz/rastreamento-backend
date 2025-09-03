// src/api/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

// KPIs + gráficos
router.get('/kpis', authMiddleware, isAdmin, dashboardController.getKpis);

// Embarcadores para o filtro
router.get('/companies', authMiddleware, isAdmin, dashboardController.getCompanies);

// Tabela de operações
router.get('/operations', authMiddleware, isAdmin, dashboardController.getOperations);

// (Opcional) Usuários pendentes
router.get('/pending-users', authMiddleware, isAdmin, dashboardController.getPendingUsers);

module.exports = router;