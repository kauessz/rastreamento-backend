// src/api/aiRoutes.js
const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

// Protegida para que apenas admins logados possam acessá-la
router.post('/analyze', authMiddleware, adminMiddleware, aiController.analyzeOperations);

module.exports = router;