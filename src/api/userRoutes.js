// src/api/userRoutes.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Importar nossos middlewares
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

// Rota pública para registro
router.post('/register', userController.registerUser);

// Rota para admin ver usuários pendentes. Protegida.
router.get('/admin/pending', authMiddleware, isAdmin, userController.getPendingUsers);

// Rota para o usuário logado buscar seu próprio perfil (role, status, etc.)
router.get('/me', authMiddleware, userController.getCurrentUserProfile);

// além de /admin/pending, exponha também /pending
router.get('/pending', authMiddleware, isAdmin, userController.getPendingUsers);


// Rota para admin aprovar um usuário. Protegida.
// O :id na URL é um parâmetro dinâmico
router.put('/admin/approve/:id', authMiddleware, isAdmin, userController.approveUser);

module.exports = router;