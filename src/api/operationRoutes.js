// Em: src/api/operationRoutes.js (substitua tudo)

const express = require('express');
const router = express.Router();
const operationController = require('../controllers/operationController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');
const upload = require('../config/multerConfig');

// --- Rotas Públicas ---
// Rota para o rastreamento na página inicial
router.get('/public/track/:tracking_code', operationController.trackOperationPublic);

// --- Rotas de Administrador ---
// Rota para buscar a lista de operações para o dashboard
router.get('/', authMiddleware, isAdmin, operationController.getOperations);

// Rota para fazer o upload da planilha
router.post('/upload', authMiddleware, isAdmin, upload.single('file'), operationController.uploadOperations);

// Rota para deletar TODAS as operações. Altamente restrita.
router.delete('/all', authMiddleware, isAdmin, operationController.deleteAllOperations);


module.exports = router;