// src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// (opcionais – se não instalou, tudo bem)
function tryRequire(name) { try { return require(name); } catch { return null; } }
const helmet = tryRequire('helmet');
const compression = tryRequire('compression');
const morgan = tryRequire('morgan');

const app = express();
app.set('trust proxy', 1);

// -------- Middlewares básicos --------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Segurança / perf (se disponíveis)
if (helmet) app.use(helmet());
if (compression) app.use(compression());
if (morgan) app.use(morgan('combined'));

// -------- CORS (compatível com Express 5) --------
// Use CORS_ORIGIN="https://seuapp.com,https://outroapp.com" para liberar origens específicas
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  credentials: false,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  origin: (origin, cb) => {
    // Libera ferramentas sem origem (curl, healthcheck) e, se não configurar, libera geral
    if (!origin || allowedOrigins.length === 0) return cb(null, true);
    return allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  }
};

app.use(cors(corsOptions));
// IMPORTANTE: não usar app.options('*', ...) no Express 5 (quebrava com path-to-regexp)

// -------- Static (se você tiver pasta pública) --------
// app.use(express.static(path.join(__dirname, 'public')));

// ===== Helpers de montagem =====
function safeRequire(p) {
  try { return require(p); } catch (err) {
    console.error(`Falha ao dar require em ${p}:`, err.message);
    return null;
  }
}
function mount(basePath, mod) {
  if (!mod) return;
  if (typeof basePath !== 'string' || !basePath.startsWith('/')) {
    console.error(`Path inválido ao montar rotas: "${basePath}". Deve começar com "/". Ignorando.`);
    return;
  }
  app.use(basePath, mod);
  console.log(`Rotas montadas em ${basePath}`);
}

// ===== Webhook do Dialogflow (Fulfillment) =====
// Você pode manter seu agente sem webhook (respostas estáticas).
// Se quiser usar, aponte o Fulfillment para uma destas URLs:
function dialogflowHandler(req, res) {
  try {
    const body       = req.body || {};
    const queryText  = body?.queryResult?.queryText || '';
    const parameters = body?.queryResult?.parameters || {};
    const session    = body?.session || '';

    // Exemplo simples — troque pela sua lógica (buscar BD etc.)
    const parts = [];
    if (queryText)  parts.push(`Você disse: "${queryText}"`);
    if (parameters && Object.keys(parameters).length) parts.push(`Parâmetros: ${JSON.stringify(parameters)}`);
    if (session)    parts.push(`Sessão: ${session.split('/').pop()}`);
    const reply = parts.length ? parts.join(' | ') : 'Tudo certo por aqui!';

    return res.json({
      fulfillmentText: reply,
      fulfillmentMessages: [{ text: { text: [reply] } }],
      source: 'rastreamento-backend',
    });
  } catch (err) {
    console.error('Webhook DF erro:', err);
    return res.json({ fulfillmentText: 'Desculpe, houve um erro ao processar sua solicitação.' });
  }
}

// -------- Rotas da API --------
const userRoutes = require('./api/userRoutes');
const operationRoutes = require('./api/operationRoutes');
const dashboardRoutes = require('./api/dashboardRoutes');
const clientRoutes = require('./api/clientRoutes');
const reportsRoutes = require('./api/reportsRoutes');
const embarcadorRoutes = require('./api/embarcadorRoutes');

app.use('/api/users', userRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/embarcadores', embarcadorRoutes);

// -------- Health & raiz --------
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa 🚚'));

// -------- 404 apenas para /api --------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// -------- Error handler --------
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// -------- Start --------
const PORT = process.env.PORT || 10000;
// No Render, escutar em 0.0.0.0 é seguro
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API up on :${PORT}`);
});
