// src/api/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

router.get('/kpis', authMiddleware, isAdmin, dashboardController.getKpis);

module.exports = router;