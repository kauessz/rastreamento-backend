const db = require('../database'); // usa o Pool já existente

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS aliases (
      id SERIAL PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      master TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
}

async function listAliases() {
  const { rows } = await db.query('SELECT alias, master FROM aliases ORDER BY alias ASC;');
  return rows;
}

async function upsertAlias(alias, master) {
  const { rows } = await db.query(`
    INSERT INTO aliases (alias, master, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (alias) DO UPDATE SET master = EXCLUDED.master, updated_at = now()
    RETURNING alias, master;
  `, [alias, master]);
  return rows[0];
}

module.exports = { ensureTable, listAliases, upsertAlias };