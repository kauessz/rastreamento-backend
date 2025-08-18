// src/middlewares/authMiddleware.js
const admin = require('../config/firebase');

const authMiddleware = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next(); // preflight passa

  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m && m[1];

  if (!token) {
    return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erro na verificação do token:', error);
    return res.status(403).json({ message: 'Token inválido ou expirado.' });
  }
};

module.exports = authMiddleware;