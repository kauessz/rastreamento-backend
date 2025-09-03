// src/api/operationRoutes.js
const express = require('express');
const router = express.Router();
const operationController = require('../controllers/operationController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');
const upload = require('../config/multerConfig');

// Públicas
router.get('/public/track/:tracking_code', operationController.trackOperationPublic);

// Admin originais
router.get('/', authMiddleware, isAdmin, operationController.getOperations);
router.post('/upload', authMiddleware, isAdmin, upload.single('file'), operationController.uploadOperations);
router.delete('/all', authMiddleware, isAdmin, operationController.deleteAllOperations);

// Aliases usados pelo front
router.post('/upload-xlsx', authMiddleware, isAdmin, upload.single('file'), operationController.uploadOperations);
router.post('/wipe', authMiddleware, isAdmin, operationController.deleteAllOperations);

module.exports = router;