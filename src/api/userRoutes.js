// src/api/userRoutes.js
const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

async function verifyBearer(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!idToken) return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Não autorizado: Token inválido.', detail: e.message });
  }
}

/**
 * ATENÇÃO:
 * Nada de '/me*' ou '/me/*'. Use apenas '/me' (exato) ou a sintaxe nova '/me/:rest*' se precisar.
 */
router.get('/me', verifyBearer, (req, res) => {
  const u = req.user || {};

  const isAdmin =
    u.admin === true ||
    u.role === 'admin' ||
    (u.customClaims && (u.customClaims.admin === true || u.customClaims.role === 'admin'));

  return res.json({
    uid: u.uid,
    email: u.email || null,
    name: u.name || u.displayName || null,
    admin: !!isAdmin
  });
});

// Exemplo de rota que aceita qualquer coisa depois de /me, SE realmente precisar:
// router.get('/me/:rest*', verifyBearer, (req, res) => { ... });

module.exports = router;