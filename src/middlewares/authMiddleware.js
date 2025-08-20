// src/middleware/authMiddleware.js
const admin = require('firebase-admin');

module.exports = async function authMiddleware(req, res, next) {
  try {
    let idToken = null;

    // 1) Authorization: Bearer <token>
    const auth = req.get('authorization') || req.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      idToken = auth.slice(7);
    }

    // 2) Header alternativo
    if (!idToken) {
      idToken = req.get('x-auth-token') || req.get('X-Auth-Token') || null;
    }

    // 3) Querystring (para downloads via window.open)
    if (!idToken) {
      idToken = req.query.token || req.query.idToken || null;
    }

    if (!idToken) {
      return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      claims: decoded
    };
    return next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    return res.status(401).json({ message: 'Não autorizado: Token inválido.' });
  }
};
