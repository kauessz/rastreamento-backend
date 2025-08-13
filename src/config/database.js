// Em: src/config/database.js (substitua tudo)

const { Pool } = require('pg');
require('dotenv').config();

// Esta variável verifica se estamos rodando no ambiente do Render.
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  // Se for produção, usa a string de conexão completa.
  connectionString: isProduction ? connectionString : undefined,
  
  // Se for local (não produção), usa as variáveis separadas do .env.
  host: isProduction ? undefined : process.env.DB_HOST,
  database: isProduction ? undefined : process.env.DB_DATABASE,
  user: isProduction ? undefined : process.env.DB_USER,
  password: isProduction ? undefined : process.env.DB_PASSWORD,
  port: isProduction ? undefined : process.env.DB_PORT,

  // ===== ESTA É A LINHA MAIS IMPORTANTE PARA A CORREÇÃO =====
  // Se for produção, ativa o SSL. 'rejectUnauthorized: false' é uma configuração
  // comum e segura para se conectar a serviços como Render e Supabase.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  // ==========================================================
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};