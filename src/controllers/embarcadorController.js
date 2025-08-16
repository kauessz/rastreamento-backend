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

// Função para listar todos os apelidos e a qual mestre eles pertencem
exports.getAllAliases = async (req, res) => {
    try {
        const query = `
            SELECT 
                ea.id, 
                ea.nome_alias, 
                emb.nome_principal AS mestre_nome 
            FROM 
                embarcador_aliases ea
            JOIN 
                embarcadores emb ON ea.embarcador_id = emb.id
            ORDER BY 
                ea.nome_alias ASC;
        `;
        const { rows } = await db.query(query);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Erro ao buscar aliases:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};

// Função para reassociar um apelido a um novo mestre
exports.reassignAlias = async (req, res) => {
    const { aliasId } = req.params;
    const { newMasterId } = req.body;

    if (!newMasterId) {
        return res.status(400).json({ message: 'ID do novo mestre é obrigatório.' });
    }

    try {
        const { rows } = await db.query(
            'UPDATE embarcador_aliases SET embarcador_id = $1 WHERE id = $2 RETURNING id, nome_alias',
            [newMasterId, aliasId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Apelido não encontrado.' });
        }

        res.status(200).json({ message: 'Apelido reassociado com sucesso!', alias: rows[0] });
    } catch (error) {
        console.error('Erro ao reassociar alias:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};

// Função para apagar um apelido
exports.deleteAlias = async (req, res) => {
    const { aliasId } = req.params;
    try {
        await db.query('DELETE FROM embarcador_aliases WHERE id = $1', [aliasId]);
        res.status(200).json({ message: 'Apelido excluído com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir alias:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};