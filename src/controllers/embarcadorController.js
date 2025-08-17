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

// Lista aliases com filtros: only=unassigned | dupe | all, e busca (q)
// Tolerante: usa unaccent se existir; se não, usa translate() como fallback.
exports.listAliases = async (req, res) => {
  try {
    const only = (req.query.only || 'unassigned').toLowerCase(); // padrão: só pendentes
    const q = (req.query.q || '').trim();

    // 1) Detecta se unaccent está instalada
    let hasUnaccent = false;
    try {
      const chk = await db.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='unaccent') AS has;"
      );
      hasUnaccent = !!chk.rows?.[0]?.has;
    } catch (_) {}

    // 2) Função normalizadora: remove acento/esp e mantém só [a-z0-9]
    const norm = (field) =>
      hasUnaccent
        ? `unaccent(lower(regexp_replace(${field}, '[^a-z0-9]', '', 'g')))`
        : `lower(
            regexp_replace(
              translate(${field},
                'ÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝáàâãäåçéèêëíìîïñóòôõöúùûüýÿ',
                'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy'
              ),
              '[^a-z0-9]', '', 'g'
            )
          )`;

    const aliasKey  = norm('a.nome_alias');
    const masterKey = norm('e.nome_principal');

    // 3) Monta WHERE pelos filtros
    const params = [];
    let where = 'TRUE';

    if (only === 'unassigned') {
      where = 'a.mestre_id IS NULL';
    } else if (only === 'dupe') {
      where = `a.mestre_id IS NOT NULL AND ${aliasKey} = ${masterKey}`;
    } // 'all' mantém TRUE

    if (q) {
      const qnorm = q.normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
      params.push(`%${qnorm}%`);
      where += ` AND (${aliasKey} LIKE $${params.length} OR ${masterKey} LIKE $${params.length})`;
    }

    // 4) Query
    const sql = `
      SELECT a.id, a.nome_alias, a.mestre_id, e.nome_principal AS mestre_nome
      FROM embarcador_aliases a
      LEFT JOIN embarcadores e ON e.id = a.mestre_id
      WHERE ${where}
      ORDER BY a.nome_alias ASC;
    `;
    const { rows } = await db.query(sql, params);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('listAliases error:', err?.message || err);
    return res.status(500).json({ message: 'Erro ao listar aliases.' });
  }
};
