// src/controllers/aliasesController.js
const db = require('../config/database'); // caminho correto

// Opcional: garante que as tabelas existam (seu schema já tem essas tabelas)
async function ensureTables() {
  // embarcadores (id, nome_principal)
  await db.query(`
    CREATE TABLE IF NOT EXISTS embarcadores (
      id SERIAL PRIMARY KEY,
      nome_principal TEXT UNIQUE NOT NULL
    );
  `);

  // embarcador_aliases (nome_alias UNIQUE, embarcador_id FK)
  await db.query(`
    CREATE TABLE IF NOT EXISTS embarcador_aliases (
      id SERIAL PRIMARY KEY,
      nome_alias TEXT UNIQUE NOT NULL,
      embarcador_id INTEGER NOT NULL REFERENCES embarcadores(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Lista alias -> mestre exatamente do mesmo repositório usado no upload.
 * Retorna [{ alias, master }]
 */
async function listAliases() {
  const { rows } = await db.query(`
    SELECT ea.nome_alias AS alias, e.nome_principal AS master
    FROM embarcador_aliases ea
    JOIN embarcadores e ON e.id = ea.embarcador_id
    ORDER BY ea.nome_alias ASC;
  `);
  return rows;
}

/**
 * Cria/atualiza um alias apontando para um "mestre" (nome_principal).
 * Se o mestre não existir, cria em embarcadores.
 * Se o alias existir, apenas re-associa ao novo mestre.
 */
async function upsertAlias(alias, master) {
  if (!alias || !master) throw new Error('alias e master são obrigatórios');

  // garante mestre
  const upMaster = await db.query(
    `INSERT INTO embarcadores (nome_principal)
     VALUES ($1) ON CONFLICT (nome_principal) DO NOTHING
     RETURNING id`,
    [master.trim()]
  );
  let masterId;
  if (upMaster.rows.length) {
    masterId = upMaster.rows[0].id;
  } else {
    const sel = await db.query(`SELECT id FROM embarcadores WHERE nome_principal = $1`, [master.trim()]);
    masterId = sel.rows[0].id;
  }

  // cria/atualiza o alias -> mestre
  const ret = await db.query(
    `INSERT INTO embarcador_aliases (nome_alias, embarcador_id)
     VALUES ($1, $2)
     ON CONFLICT (nome_alias)
     DO UPDATE SET embarcador_id = EXCLUDED.embarcador_id
     RETURNING (SELECT nome_principal FROM embarcadores WHERE id = embarcador_id) AS master, nome_alias AS alias;`,
    [alias.trim(), masterId]
  );
  return ret.rows[0];
}

module.exports = { ensureTables, listAliases, upsertAlias };