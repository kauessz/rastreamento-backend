// Em: src/config/database.js (substitua tudo)

const { Pool } = require('pg');
require('dotenv').config();

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

  // ===== LINHA ADICIONADA PARA A CORREÇÃO =====
  // Força a conexão a usar a codificação UTF-8 para lidar com acentos.
  client_encoding: 'utf8',
  // ===========================================
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};