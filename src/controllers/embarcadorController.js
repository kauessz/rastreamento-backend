// src/controllers/embarcadorController.js
const db = require('../config/database');

/**
 * Lista mestres (embarcadores) — usado para popular o <select> do gerenciador.
 */
exports.listMasters = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nome_principal FROM embarcadores ORDER BY nome_principal ASC;'
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error('listMasters error:', err);
    return res.status(500).json({ message: 'Erro ao listar embarcadores.' });
  }
};

/**
 * Lista aliases com filtros:
 *   - only = unassigned | dupe | all   (padrão: unassigned → só sem mestre)
 *   - q    = texto (busca por alias/mestre, ignorando acentos e pontuação)
 *
 * Tolerante: usa unaccent se existir; caso contrário, usa translate() como fallback.
 */
exports.listAliases = async (req, res) => {
  try {
    const only = (req.query.only || 'unassigned').toLowerCase();
    const q = (req.query.q || '').trim();

    // detecta se unaccent está instalado
    let hasUnaccent = false;
    try {
      const chk = await db.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='unaccent') AS has;"
      );
      hasUnaccent = !!chk.rows?.[0]?.has;
    } catch (_) {}

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

    const params = [];
    let where = 'TRUE';

    if (only === 'unassigned') {
      where = 'a.mestre_id IS NULL';
    } else if (only === 'dupe') {
      // aliases idênticos ao nome do mestre → candidatos a exclusão
      where = `a.mestre_id IS NOT NULL AND ${aliasKey} = ${masterKey}`;
    }

    if (q) {
      const qnorm = q.normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
      params.push(`%${qnorm}%`);
      where += ` AND (${aliasKey} LIKE $${params.length} OR ${masterKey} LIKE $${params.length})`;
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
    console.error('listAliases error:', err?.message || err);
    return res.status(500).json({ message: 'Erro ao listar aliases.' });
  }
};

/**
 * Reassocia um alias a um novo mestre.
 * Body: { newMasterId }
 */
exports.reassignAlias = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const newMasterId = Number(req.body?.newMasterId || 0);
    if (!id || !newMasterId) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const { rowCount } = await db.query(
      'UPDATE embarcador_aliases SET mestre_id = $1 WHERE id = $2;',
      [newMasterId, id]
    );
    if (!rowCount) {
      return res.status(404).json({ message: 'Alias não encontrado.' });
    }
    return res.status(200).json({ message: 'Apelido reassociado com sucesso.' });
  } catch (err) {
    console.error('reassignAlias error:', err);
    return res.status(500).json({ message: 'Erro ao reassociar alias.' });
  }
};

/**
 * Exclui um alias.
 */
exports.deleteAlias = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'ID inválido.' });

    const { rowCount } = await db.query(
      'DELETE FROM embarcador_aliases WHERE id = $1;',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ message: 'Alias não encontrado.' });
    }
    return res.status(200).json({ message: 'Apelido excluído com sucesso.' });
  } catch (err) {
    console.error('deleteAlias error:', err);
    return res.status(500).json({ message: 'Erro ao excluir alias.' });
  }
};