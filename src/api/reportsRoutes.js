// src/api/reportsRoutes.js
const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportsController');

// ===== Resolver robusto p/ authMiddleware (várias possibilidades de caminho/export) =====
function resolveAuthMiddleware() {
  const candidates = [
    '../middleware/authMiddleware',
    '../../middleware/authMiddleware',
    '../middlewares/authMiddleware',
    '../../middlewares/authMiddleware',
    '../authMiddleware',
    '../../authMiddleware'
  ];
  for (const p of candidates) {
    try {
      const mod = require(p);
      return mod.authMiddleware || mod.default || mod; // suporta export default, named ou direto
    } catch (_) {
      // tenta próxima opção
    }
  }
  throw new Error(
    "authMiddleware não encontrado. Verifique o caminho. " +
    "Ex.: coloque o arquivo em src/middleware/authMiddleware.js e use require('../middleware/authMiddleware')."
  );
}
const authMiddleware = resolveAuthMiddleware();

// ================= Rotas =================

// PDF diário
router.get('/daily', authMiddleware, reports.getDailyReport);

// Excel (Top 10 e Resumo de Atrasos)
router.get('/top-ofensores.xlsx', authMiddleware, reports.topOffendersExcel);
router.get('/atrasos.xlsx', authMiddleware, reports.resumoAtrasosExcel);

// Webhook de novo arquivo (se quiser, proteja com um token próprio no header)
router.post('/hooks/new-file', reports.webhookNewFile);

module.exports = router;