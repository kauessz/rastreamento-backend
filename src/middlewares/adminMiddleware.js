// src/middlewares/adminMiddleware.js

const db = require('../config/database');

const isAdmin = async (req, res, next) => {
  // Assumimos que o middleware de autenticação (authMiddleware) já rodou
  // e adicionou o 'uid' do Firebase no objeto 'req.user'.
  const firebase_uid = req.user.uid;

  try {
    const { rows } = await db.query('SELECT role FROM usuarios WHERE firebase_uid = $1', [firebase_uid]);

    // Verifica se o usuário foi encontrado no nosso banco e se a role é 'admin'
    if (rows.length > 0 && rows[0].role === 'admin') {
      next(); // O usuário é um admin, pode prosseguir para a próxima função.
    } else {
      res.status(403).json({ message: 'Acesso negado. Requer permissão de administrador.' });
    }
  } catch (error) {
    console.error('Erro na verificação de admin:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

module.exports = isAdmin;