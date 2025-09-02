// src/database.js
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('[db] DATABASE_URL não definida. Configure nas variáveis de ambiente.');
}

// Render/Heroku normalmente exigem SSL. Se quiser endurecer, ajuste a flag.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Exporte um helper .query + o pool, para os controllers usarem db.query(...)
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};