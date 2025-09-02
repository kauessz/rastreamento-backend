const express = require('express');
const router = express.Router();

// Middlewares (use se quiser restringir)
const auth = require('../middleware/authMiddleware');         // se seu caminho for diferente, ajuste
const admin = require('../middleware/adminMiddleware');       // opcional

const {
  getDailyDelays,
  getDailyReasons,
  getKpisRange
} = require('../controllers/analyticsController');

// Todas exigem auth; para admin-only, adicione 'admin' depois de 'auth'.
router.get('/daily-delays', auth, getDailyDelays);    // ?date=YYYY-MM-DD&companyId=
router.get('/daily-reasons', auth, getDailyReasons);  // ?date=YYYY-MM-DD&companyId=
router.get('/kpis', auth, getKpisRange);              // ?start=YYYY-MM-DD&end=YYYY-MM-DD&companyId=

module.exports = router;