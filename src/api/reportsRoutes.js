// src/api/reportsRoutes.js
const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportsController');
const auth = require('../middleware/authMiddleware'); // já existe no seu projeto

// Relatório diário (PDF) — autenticado
router.get('/daily', auth, reports.getDailyReport);

// Webhook de novo arquivo — pode proteger com token próprio, se quiser
router.post('/hooks/new-file', reports.webhookNewFile);

module.exports = router;
