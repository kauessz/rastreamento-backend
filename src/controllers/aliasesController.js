// src/controllers/aliasesController.js
const db = require('../config/database');

// Cria tabelas se não existirem
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS embarcadores (
      id SERIAL PRIMARY KEY,
      nome TEXT UNIQUE NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS embarcador_aliases (
      id SERIAL PRIMARY KEY,
      nome_alias TEXT UNIQUE NOT NULL,
      embarcador_id INTEGER NOT NULL REFERENCES embarcadores(id) ON DELETE CASCADE
    );
  `);
}

async function listAliases() {
  const { rows } = await db.query(`
    SELECT a.id, a.nome_alias AS alias, e.nome AS master
    FROM embarcador_aliases a
    JOIN embarcadores e ON e.id = a.embarcador_id
    ORDER BY a.nome_alias ASC
  `);
  return rows;
}

async function upsertAlias(alias, master) {
  // garante mestre
  const up = await db.query(
    `INSERT INTO embarcadores (nome) VALUES ($1)
     ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [master.trim()]
  );
  const masterId = up.rows[0].id;

  // cria/atualiza alias
  const ret = await db.query(
    `INSERT INTO embarcador_aliases (nome_alias, embarcador_id)
     VALUES ($1, $2)
     ON CONFLICT (nome_alias) DO UPDATE SET embarcador_id = EXCLUDED.embarcador_id
     RETURNING id, nome_alias AS alias`,
    [alias.trim(), masterId]
  );

  return { id: ret.rows[0].id, alias: ret.rows[0].alias, master };
}

async function deleteAlias(id) {
  await db.query(`DELETE FROM embarcador_aliases WHERE id = $1`, [id]);
}

module.exports = { ensureTables, listAliases, upsertAlias, deleteAlias };