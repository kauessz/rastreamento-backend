// src/api/userRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Seus controllers e middlewares existentes
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

/**
 * ROTA DE PERFIL DO USUÁRIO LOGADO
 * Aceita /me e também variações tipo /me:qualquerCoisa (cache-busting, etc.)
 * Retorna sempre JSON.
 */
router.get(['/me', '/me*'], authMiddleware, async (req, res) => {
  try {
    // Se o authMiddleware já populou req.user, usamos.
    // Caso contrário, tentamos ler e verificar o token aqui (fallback).
    let u = req.user;
    if (!u) {
      const auth = req.headers.authorization || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!idToken) {
        return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });
      }
      u = await admin.auth().verifyIdToken(idToken);
    }

    const isAdminFlag =
      u.admin === true ||
      u.role === 'admin' ||
      (u.customClaims && (u.customClaims.admin === true || u.customClaims.role === 'admin'));

    return res.json({
      uid: u.uid,
      email: u.email || null,
      name: u.name || u.displayName || null,
      admin: !!isAdminFlag,
    });
  } catch (e) {
    return res.status(401).json({ message: 'Não autorizado: Token inválido.', detail: e.message });
  }
});

/**
 * ROTAS EXISTENTES (mantidas)
 */

// Registro público
router.post('/register', userController.registerUser);

// Usuários pendentes (admin)
router.get('/admin/pending', authMiddleware, isAdmin, userController.getPendingUsers);
router.get('/pending', authMiddleware, isAdmin, userController.getPendingUsers);

// Aprovação de usuário (admin)
router.put('/admin/approve/:id', authMiddleware, isAdmin, userController.approveUser);

module.exports = router;