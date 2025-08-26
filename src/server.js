// src/server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ===== tenta carregar libs opcionais (não quebram se faltarem) =====
function tryRequire(name) { try { return require(name); } catch { return null; } }
const helmet      = tryRequire('helmet');
const compression = tryRequire('compression');
const morgan      = tryRequire('morgan');

// ===== App =====
const app = express();
app.set('trust proxy', 1);

// ===== CORS seguro (NÃO usar URL como path) =====
const allowedOrigins = [
  process.env.FRONT_ORIGIN,             // ex.: https://tracking-r.netlify.app
  'https://tracking-r.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                       // health checks / curl
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origem não permitida -> ${origin}`), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};

app.use(cors(corsOptions));
app.options('/(.*)', cors(corsOptions)); // casa qualquer caminho

// ===== Segurança / Perf (opcionais) =====
if (helmet) {
  app.use(helmet({ crossOriginResourcePolicy: false }));
}
if (compression) app.use(compression());
if (morgan) app.use(morgan('dev'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== Firebase Admin (opcional) =====
try {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    // se GOOGLE_APPLICATION_CREDENTIALS estiver setada, ele usa automaticamente
    admin.initializeApp();
    console.log('Firebase Admin SDK inicializado com sucesso.');
  }
} catch (e) {
  console.warn('Firebase Admin não carregado (opcional):', e.message);
}

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

// ===== Rotas da API (sempre com "/api/...") =====
const userRoutes        = safeRequire('./api/userRoutes');
const operationRoutes   = safeRequire('./api/operationRoutes');
const embarcadorRoutes  = safeRequire('./api/embarcadorRoutes');
const dashboardRoutes   = safeRequire('./api/dashboardRoutes');
const clientRoutes      = safeRequire('./api/clientRoutes');
const reportsRoutes     = safeRequire('./api/reportsRoutes');

mount('/api/users',        userRoutes);
mount('/api/operations',   operationRoutes);
mount('/api/embarcadores', embarcadorRoutes);
mount('/api/dashboard',    dashboardRoutes);
mount('/api/client',       clientRoutes);
mount('/api/reports',      reportsRoutes);

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

// Disponibiliza em três caminhos para compatibilidade com o que você já usou:
app.post('/api/hooks/dialogflow', dialogflowHandler);
app.post('/api/webhook/dialogflow', dialogflowHandler);
app.post('/webhook/dialogflow', dialogflowHandler);

// ===== Health e raiz =====
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa 🚚'));

// ===== 404 (apenas para /api) =====
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ===== Error handler =====
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ===== Start =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));