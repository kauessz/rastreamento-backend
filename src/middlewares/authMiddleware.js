// src/middleware/authMiddleware.js
const admin = require('firebase-admin');

/**
 * Autentica via Firebase ID Token.
 * - Aceita Authorization: Bearer <token>, X-Auth-Token ou ?token=
 * - Populará req.user (payload do token), req.userId e req.userEmail
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    // 1) Coleta token de vários lugares
    let token =
      req.headers.authorization ||
      req.headers['x-auth-token'] ||
      req.query.token ||
      '';

    // 2) Remove prefixo "Bearer "
    if (typeof token === 'string' && token.toLowerCase().startsWith('bearer ')) {
      token = token.slice(7).trim();
    }

    if (!token) {
      return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });
    }

    // 3) Valida no Firebase Admin
    const decoded = await admin.auth().verifyIdToken(token);

    // 4) Anexa dados úteis à request
    req.user = decoded;                 // payload completo
    req.userId = decoded.uid;           // UID do Firebase
    req.userEmail = decoded.email || ''; // e-mail (se existir)

    return next();
  } catch (err) {
    // Log claro no Render para diagnosticar: projeto incorreto, token expirado, etc.
    console.error('verifyIdToken error:',
      err?.errorInfo?.message || err?.message || err);
    return res.status(401).json({ message: 'Não autorizado: Token inválido.' });
  }
};