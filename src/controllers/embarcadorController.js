// src/controllers/embarcadorController.js
const db = require('../config/database');

exports.getAllEmbarcadores = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, nome_principal FROM embarcadores ORDER BY nome_principal ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erro ao buscar embarcadores:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};