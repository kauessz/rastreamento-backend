// src/api/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

router.get('/kpis', authMiddleware, isAdmin, dashboardController.getKpis);
router.get('/companies', authMiddleware, isAdmin, dashboardController.getCompanies);
router.get('/operations', authMiddleware, isAdmin, dashboardController.getOperations);
router.get('/pending-users', authMiddleware, isAdmin, dashboardController.getPendingUsers);

module.exports = router;