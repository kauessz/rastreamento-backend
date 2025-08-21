const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportsController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin        = require('../middlewares/adminMiddleware');

// Admin-only
router.get('/daily',               authMiddleware, isAdmin, reports.getDailyReport);
router.get('/top-ofensores.xlsx',  authMiddleware, isAdmin, reports.topOffendersExcel);
router.get('/atrasos.xlsx',        authMiddleware, isAdmin, reports.resumoAtrasosExcel);

// Webhook (se quiser, proteja com token via header)
router.post('/hooks/new-file', reports.webhookNewFile);

module.exports = router;
