const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware'); // se quiser restringir

const { sendDailyDelaysEmail } = require('../controllers/emailsController');

// POST /api/emails/daily-delays  { date?: 'YYYY-MM-DD', companyId?: number, to?: [emails] }
router.post('/daily-delays', auth /*, admin*/, sendDailyDelaysEmail);

module.exports = router;