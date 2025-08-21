// src/api/reportsRoutes.js
const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportsController');
const authMiddleware = require('../middlewares/authMiddleware'); // plural
const isAdmin        = require('../middlewares/adminMiddleware'); // plural

// resolutores robustos para middlewares
function resolveAuth() {
  const candidates = [
    '../middleware/authMiddleware',
    '../../middleware/authMiddleware',
    '../middlewares/authMiddleware',
    '../../middlewares/authMiddleware'
  ];
  for (const p of candidates) { try {
    const mod = require(p);
    return mod.authMiddleware || mod.default || mod;
  } catch {} }
  throw new Error('authMiddleware não encontrado.');
}
function resolveIsAdmin() {
  const candidates = [
    '../middleware/adminMiddleware',
    '../../middleware/adminMiddleware',
    '../middlewares/adminMiddleware',
    '../../middlewares/adminMiddleware'
  ];
  for (const p of candidates) { try {
    const mod = require(p);
    return mod.isAdmin || mod.default || mod; // suporta export direto ou nomeado
  } catch {} }
  throw new Error('adminMiddleware (isAdmin) não encontrado.');
}

const authMiddleware = resolveAuth();
const isAdmin = resolveIsAdmin();

// ===== ROTAS (agora admin-only) =====
router.get('/daily', authMiddleware, isAdmin, reports.getDailyReport);
router.get('/top-ofensores.xlsx', authMiddleware, isAdmin, reports.topOffendersExcel);
router.get('/atrasos.xlsx', authMiddleware, isAdmin, reports.resumoAtrasosExcel);

// Webhook: se quiser, também pode proteger com token interno
router.post('/hooks/new-file', reports.webhookNewFile);

module.exports = router;