// src/controllers/aliasesController.js
const db = require('../config/database');

const meta = {
  hasEA: null,  // embarcador_aliases
  hasEmb: null, // embarcadores
  embNameCol: null, // 'nome' | 'nome_principal' | 'name' | 'razao_social' | etc.
  hasAliases: null, // tabela 'aliases' simples
  aliasesCols: null // { id, alias, master }
};

async function tableExists(name) {
  const q = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return !!(q.rows[0] && q.rows[0].reg);
}
async function colExists(table, column) {
  const q = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]
  );
  return q.rowCount > 0;
}
async function ensureMeta() {
  if (meta.hasEA === null)  meta.hasEA  = await tableExists('embarcador_aliases');
  if (meta.hasEmb === null) meta.hasEmb = await tableExists('embarcadores');
  if (meta.hasAliases === null) meta.hasAliases = await tableExists('aliases');

  if (meta.hasEmb && meta.embNameCol === null) {
    const candidates = ['nome','nome_principal','name','razao_social','descricao','cliente'];
    for (const c of candidates) { // eslint-disable-next-line no-await-in-loop
      if (await colExists('embarcadores', c)) { meta.embNameCol = c; break; }
    }
    if (!meta.embNameCol) meta.embNameCol = 'nome'; // fallback
  }

  if (meta.hasAliases && meta.aliasesCols === null) {
    const aliasCands  = ['alias','nome_alias','apelido','dirty','apelido_nome'];
    const masterCands = ['master','nome_mestre','mestre','master_name','cliente','nome'];

    let aliasCol = null, masterCol = null;
    for (const c of aliasCands) { // eslint-disable-next-line no-await-in-loop
      if (await colExists('aliases', c)) { aliasCol = c; break; }
    }
    for (const c of masterCands) { // eslint-disable-next-line no-await-in-loop
      if (await colExists('aliases', c)) { masterCol = c; break; }
    }
    meta.aliasesCols = { id: 'id', alias: aliasCol, master: masterCol };
  }
}

/* ---------------- API ---------------- */
exports.ensureTables = async () => {}; // não criar nada automaticamente

exports.listAliases = async () => {
  await ensureMeta();

  if (meta.hasEA && meta.hasEmb && meta.embNameCol) {
    const q = await db.query(
      `SELECT a.id, a.nome_alias AS alias, e."${meta.embNameCol}" AS master
         FROM embarcador_aliases a
         JOIN embarcadores e ON e.id = a.embarcador_id
        ORDER BY a.nome_alias ASC`
    );
    return q.rows;
  }

  if (meta.hasAliases && meta.aliasesCols?.alias && meta.aliasesCols?.master) {
    const { id, alias, master } = meta.aliasesCols;
    const q = await db.query(
      `SELECT ${id} AS id, "${alias}" AS alias, "${master}" AS master
         FROM aliases
        ORDER BY "${alias}" ASC`
    );
    return q.rows;
  }

  return [];
};

exports.upsertAlias = async (alias, master) => {
  await ensureMeta();

  if (meta.hasEmb && meta.hasEA && meta.embNameCol) {
    const up = await db.query(
      `INSERT INTO embarcadores ("${meta.embNameCol}") VALUES ($1)
         ON CONFLICT ("${meta.embNameCol}") DO UPDATE SET "${meta.embNameCol}" = EXCLUDED."${meta.embNameCol}"
       RETURNING id`,
      [master.trim()]
    );
    const masterId = up.rows[0].id;

    const ret = await db.query(
      `INSERT INTO embarcador_aliases (nome_alias, embarcador_id)
       VALUES ($1, $2)
       ON CONFLICT (nome_alias) DO UPDATE SET embarcador_id = EXCLUDED.embarcador_id
       RETURNING id, nome_alias AS alias`,
      [alias.trim(), masterId]
    );
    return { id: ret.rows[0].id, alias: ret.rows[0].alias, master };
  }

  if (meta.hasAliases && meta.aliasesCols?.alias && meta.aliasesCols?.master) {
    const { alias: aCol, master: mCol } = meta.aliasesCols;
    const ret = await db.query(
      `INSERT INTO aliases ("${aCol}","${mCol}") VALUES ($1,$2)
       ON CONFLICT ("${aCol}") DO UPDATE SET "${mCol}" = EXCLUDED."${mCol}"
       RETURNING id, "${aCol}" AS alias, "${mCol}" AS master`,
      [alias.trim(), master.trim()]
    );
    return ret.rows[0];
  }

  throw new Error('Não há tabela de aliases disponível.');
};

exports.deleteAlias = async (id) => {
  await ensureMeta();
  if (meta.hasEA)       return db.query(`DELETE FROM embarcador_aliases WHERE id = $1`, [id]);
  if (meta.hasAliases)  return db.query(`DELETE FROM aliases WHERE id = $1`, [id]);
};