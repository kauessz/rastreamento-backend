// Em: src/config/database.js

const { Pool } = require('pg');
require('dotenv').config();

// Esta nova configuração verifica se existe uma DATABASE_URL (para produção no Render).
// Se não existir, ela usa as variáveis separadas (para desenvolvimento no seu PC).
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: isProduction ? connectionString : undefined,
  host: isProduction ? undefined : process.env.DB_HOST,
  database: isProduction ? undefined : process.env.DB_DATABASE,
  user: isProduction ? undefined : process.env.DB_USER,
  password: isProduction ? undefined : process.env.DB_PASSWORD,
  port: isProduction ? undefined : process.env.DB_PORT,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};