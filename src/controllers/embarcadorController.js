// src/controllers/embarcadorController.js
const db = require('../config/database');

/**
 * Candidatos de nome para a coluna que referencia o "mestre" na tabela de aliases.
 * Ex.: mestre_id (padrão), id_mestre, embarcador_mestre_id, mestre, mestreId...
 */
const MASTER_COL_CANDIDATES = [
  'mestre_id',
  'id_mestre',
  'embarcador_mestre_id',
  'mestre',
  'mestreid',
  'mestreId'
];

/** Descobre dinamicamente o nome da coluna "mestre" em public.embarcador_aliases */
async function resolveMasterCol() {
  const { rows } = await db.query(
    `
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'embarcador_aliases'
         AND column_name = ANY($1::text[])
       LIMIT 1;
    `,
    [MASTER_COL_CANDIDATES]
  );
  return rows[0]?.column_name || null;
}

/** Verifica se a extensão unaccent está instalada */
async function hasUnaccentExt() {
  try {
    const chk = await db.query(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='unaccent') AS has;"
    );
    return !!chk.rows?.[0]?.has;
  } catch {
    return false;
  }
}

/** Gera expressão SQL de normalização (sem acentos e sem pontuação) */
function normExpr(field, useUnaccent) {
  if (useUnaccent) {
    return `unaccent(lower(regexp_replace(${field}, '[^a-z0-9]', '', 'g')))`;
  }
  // fallback sem unaccent
  return `lower(
            regexp_replace(
              translate(${field},
                'ÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝáàâãäåçéèêëíìîïñóòôõöúùûüýÿ',
                'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy'
              ),
              '[^a-z0-9]', '', 'g'
            )
          )`;
}

/* =========================
 * Lista mestres (para o <select>)
 * ========================= */
exports.listMasters = async (_req, res) => {
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

/* =========================
 * Lista aliases (com filtros opcionais)
 *   - only = unassigned | dupe | all (padrão: unassigned)
 *   - q    = texto livre (busca em alias e mestre, normalizado)
 * ========================= */
exports.listAliases = async (req, res) => {
  try {
    const only = String(req.query.only || 'unassigned').toLowerCase();
    const qRaw = String(req.query.q || '').trim();

    const masterCol = await resolveMasterCol();     // pode ser null
    const hasUnaccent = await hasUnaccentExt();

    const aliasKey  = normExpr('a.nome_alias', hasUnaccent);
    const masterKey = masterCol
      ? normExpr('e.nome_principal', hasUnaccent)
      : null;

    const whereParts = [];
    const params = [];

    // Filtro "only"
    if (only === 'unassigned') {
      // Se não existe coluna de mestre, consideramos todos como "unassigned"
      if (masterCol) whereParts.push(`a."${masterCol}" IS NULL`);
    } else if (only === 'dupe') {
      // Só dá para detectar duplicados se existe coluna de mestre
      if (masterCol) {
        whereParts.push(`a."${masterCol}" IS NOT NULL AND ${aliasKey} = ${masterKey}`);
      } else {
        // sem coluna de mestre, não há como identificar duplicados → retorna lista vazia
        return res.status(200).json([]);
      }
    } else {
      // all → sem filtro adicional
    }

    // Filtro por texto
    if (qRaw) {
      // normaliza texto do usuário
      const qnorm = qRaw
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();

      params.push(`%${qnorm}%`);
      if (masterCol) {
        whereParts.push(`(${aliasKey} LIKE $${params.length} OR ${masterKey} LIKE $${params.length})`);
      } else {
        whereParts.push(`(${aliasKey} LIKE $${params.length})`);
      }
    }

    const whereSQL = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Monta SELECT tolerante: se não houver coluna de mestre, devolve mestre_id/nome como null
    let sql;
    if (masterCol) {
      sql = `
        SELECT
          a.id,
          a.nome_alias,
          a."${masterCol}" AS mestre_id,
          e.nome_principal  AS mestre_nome
        FROM embarcador_aliases a
        LEFT JOIN embarcadores e ON e.id = a."${masterCol}"
        ${whereSQL}
        ORDER BY a.nome_alias ASC;
      `;
    } else {
      sql = `
        SELECT
          a.id,
          a.nome_alias,
          NULL::int  AS mestre_id,
          NULL::text AS mestre_nome
        FROM embarcador_aliases a
        ${whereSQL}
        ORDER BY a.nome_alias ASC;
      `;
    }

    const { rows } = await db.query(sql, params);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('listAliases error:', err?.message || err);
    return res.status(500).json({ message: 'Erro ao listar aliases.' });
  }
};

/* =========================
 * Reassocia um alias a um novo mestre
 * Body: { newMasterId }
 * ========================= */
// reassignAlias que cria a coluna mestre_id automaticamente, se não existir
exports.reassignAlias = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const newMasterId = Number(req.body?.newMasterId || 0);
    if (!id || !newMasterId) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    // Descobre se existe alguma coluna de mestre
    let masterCol = await resolveMasterCol();

    // Se não existe, cria 'mestre_id' agora
    if (!masterCol) {
      try {
        await db.query(`ALTER TABLE public.embarcador_aliases
                        ADD COLUMN IF NOT EXISTS mestre_id integer;`);
        // Índice para deixar rápido
        await db.query(`CREATE INDEX IF NOT EXISTS ix_embarcador_aliases_mestre
                        ON public.embarcador_aliases (mestre_id);`);
        // FK (tolerante: se já existir, ignora erro)
        await db.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.table_constraints
               WHERE table_name = 'embarcador_aliases'
                 AND constraint_type = 'FOREIGN KEY'
                 AND constraint_name = 'embarcador_aliases_mestre_fk'
            ) THEN
              ALTER TABLE public.embarcador_aliases
                ADD CONSTRAINT embarcador_aliases_mestre_fk
                FOREIGN KEY (mestre_id) REFERENCES public.embarcadores(id);
            END IF;
          END$$;
        `);
        masterCol = 'mestre_id';
      } catch (e) {
        console.error('DDL mestre_id error:', e);
        return res.status(500).json({
          message: 'Não foi possível criar a coluna de mestre automaticamente. ' +
                   'Crie a coluna manualmente (mestre_id integer) e tente novamente.'
        });
      }
    }

    const { rowCount } = await db.query(
      `UPDATE public.embarcador_aliases SET "${masterCol}" = $1 WHERE id = $2;`,
      [newMasterId, id]
    );

    if (!rowCount) return res.status(404).json({ message: 'Alias não encontrado.' });
    return res.status(200).json({ message: 'Apelido reassociado com sucesso.' });
  } catch (err) {
    console.error('reassignAlias error:', err);
    return res.status(500).json({ message: 'Erro ao reassociar alias.' });
  }
};

/* =========================
 * Exclui um alias
 * ========================= */
exports.deleteAlias = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'ID inválido.' });

    const { rowCount } = await db.query(
      'DELETE FROM embarcador_aliases WHERE id = $1;',
      [id]
    );

    if (!rowCount) return res.status(404).json({ message: 'Alias não encontrado.' });
    return res.status(200).json({ message: 'Apelido excluído com sucesso.' });
  } catch (err) {
    console.error('deleteAlias error:', err);
    return res.status(500).json({ message: 'Erro ao excluir alias.' });
  }
};