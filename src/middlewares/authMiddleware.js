const admin = require('../config/firebase');

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // Adiciona os dados do usuário do firebase à requisição
    next();
  } catch (error) {
    console.error('Erro na verificação do token:', error);
    return res.status(403).json({ message: 'Token inválido ou expirado.' });
  }
};

module.exports = authMiddleware;