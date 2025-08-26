// src/server.js
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const path        = require('path');

// ===============================
// App / CORS / JSON
// ===============================
const app = express();
app.set('trust proxy', 1);

// --------- CORS ---------
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
    // Permite ferramentas tipo curl/postman (sem origin)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origem não permitida -> ${origin}`), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --------- Segurança / Perf ---------
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===============================
// Firebase Admin (opcional)
// ===============================
try {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    // Se você usa credenciais via GOOGLE_APPLICATION_CREDENTIALS no Render,
    // o initializeApp() sem args já lê do env.
    admin.initializeApp();
    console.log('Firebase Admin SDK inicializado com sucesso.');
  }
} catch (e) {
  console.warn('Firebase Admin não carregado (opcional):', e.message);
}

// ===============================
// Helpers de montagem (inofensivos)
// ===============================
function safeRequire(p) {
  try { return require(p); } catch (_) { return null; }
}
function mount(pathPrefix, mod) {
  if (mod) app.use(pathPrefix, mod);
}

// ===============================
// Rotas da API
// ===============================
// NUNCA use URLs absolutas aqui (ex.: "https://..."), sempre prefixos tipo "/api/xyz"
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

// ===============================
// Webhook Dialogflow
// ===============================
// Se você usar Dialogflow Fulfillment (Intents com "Use webhook"),
// aponte o Fulfillment para:  <BACKEND_BASE_URL>/api/hooks/dialogflow
app.post('/api/hooks/dialogflow', async (req, res) => {
  try {
    const body = req.body || {};
    // Estrutura típica do Dialogflow ES:
    // body.queryResult.queryText   -> texto do usuário
    // body.queryResult.parameters  -> parâmetros extraídos
    // body.session                 -> sessão
    const queryText  = body?.queryResult?.queryText || '';
    const parameters = body?.queryResult?.parameters || {};
    const session    = body?.session || '';

    // Ponto de extensão: aqui você pode ligar no seu BD e responder de forma dinâmica.
    // Exemplo simples: ecoa o que veio.
    const reply = await handleDialogflowFulfillment({ queryText, parameters, session });

    // Retorno no formato Dialogflow webhook
    return res.json({
      fulfillmentText: reply || 'Ok!',
      fulfillmentMessages: [{ text: { text: [reply || 'Ok!'] } }],
      source: 'rastreamento-backend',
    });
  } catch (err) {
    console.error('Webhook DF erro:', err);
    return res.json({
      fulfillmentText: 'Desculpe, houve um erro ao processar sua solicitação.',
    });
  }
});

// Função de apoio para o webhook (exemplo bem simples)
async function handleDialogflowFulfillment({ queryText, parameters, session }) {
  // Coloque aqui integrações com seu BD (ex.: buscar status do booking/contêiner)
  // Para demo, apenas responde com o que recebeu:
  const parts = [];
  if (queryText)  parts.push(`Você disse: "${queryText}"`);
  if (parameters && Object.keys(parameters).length) {
    parts.push(`Parâmetros: ${JSON.stringify(parameters)}`);
  }
  if (session) parts.push(`Sessão: ${session.split('/').pop()}`);
  return parts.length ? parts.join(' | ') : 'Tudo certo por aqui!';
}

// ===============================
// Health e raiz
// ===============================
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa 🚚'));

// 404 (apenas para /api, se quiser)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ===============================
// Start
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API up on :${PORT}`);
});