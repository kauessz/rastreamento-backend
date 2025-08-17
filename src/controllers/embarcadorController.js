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

// Lista de aliases com filtros: only=unassigned | dupe | all, e busca (q)
exports.listAliases = async (req, res) => {
  try {
    const only = (req.query.only || 'unassigned').toLowerCase(); // padrão: só pendentes
    const q = (req.query.q || '').trim();

    // Normalização no SQL: minúsculo, sem acentos, só [a-z0-9]
    const aliasKey = `unaccent(lower(regexp_replace(a.nome_alias, '[^a-z0-9]', '', 'g')))`;
    const masterKey = `unaccent(lower(regexp_replace(e.nome_principal, '[^a-z0-9]', '', 'g')))`;

    const params = [];
    let where = 'TRUE';

    if (only === 'unassigned') {
      where = 'a.mestre_id IS NULL';
    } else if (only === 'dupe') {
      // aliases que são iguais ao nome do mestre (provável duplicado — dá pra excluir)
      where = `a.mestre_id IS NOT NULL AND ${aliasKey} = ${masterKey}`;
    } // 'all' mantém where = TRUE

    if (q) {
      // busca por texto (normalizando o termo no JS também)
      const qnorm = q.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      params.push(`%${qnorm}%`);
      where += ` AND (
        ${aliasKey} LIKE $${params.length}
        OR ${masterKey} LIKE $${params.length}
      )`;
    }

    const sql = `
      SELECT
        a.id,
        a.nome_alias,
        a.mestre_id,
        e.nome_principal AS mestre_nome
      FROM embarcador_aliases a
      LEFT JOIN embarcadores e ON e.id = a.mestre_id
      WHERE ${where}
      ORDER BY a.nome_alias ASC;
    `;

    const { rows } = await db.query(sql, params);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('listAliases error:', err);
    return res.status(500).json({ message: 'Erro ao listar aliases.' });
  }
};
