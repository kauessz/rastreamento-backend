// src/config/database.js

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// A correção está aqui: agora exportamos o pool e a função query.
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};