// src/server.js
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');
const fs          = require('fs');
const path        = require('path');
const admin       = require('firebase-admin');

const app = express();

// ================================= Firebase Admin =================================
(function initFirebaseAdmin() {
  try {
    if (admin.apps.length) return;

    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (svcJson) {
      const creds = JSON.parse(svcJson);
      admin.initializeApp({
        credential: admin.credential.cert(creds)
      });
      console.log('[auth] Firebase Admin inicializado (JSON).');
      return;
    }

    const PROJECT_ID   = process.env.FIREBASE_PROJECT_ID;
    const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    let PRIVATE_KEY    = process.env.FIREBASE_PRIVATE_KEY;

    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
      PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    if (PROJECT_ID && CLIENT_EMAIL && PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: PROJECT_ID,
          clientEmail: CLIENT_EMAIL,
          privateKey: PRIVATE_KEY
        })
      });
      console.log('[auth] Firebase Admin inicializado (variáveis separadas).');
    } else {
      console.warn('[auth] Firebase Admin NÃO inicializado: credenciais ausentes.');
    }
  } catch (e) {
    console.error('[auth] Erro ao inicializar Firebase Admin:', e);
  }
})();

// ================================= Middlewares base ===============================
app.set('trust proxy', true);

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // ferramentas internas/health
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: false // desliga CSP por segurança até configurarmos fontes/scripts
}));
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200
});
app.use('/api/', limiter);

// ============================= Montagem tolerante de rotas ========================
function tryMount(prefix, fileRelPath) {
  try {
    const full = path.join(__dirname, fileRelPath);
    if (fs.existsSync(full)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const router = require(full);
      app.use(prefix, router);
      console.log(`[routes] Mounted ${prefix} -> ${fileRelPath}`);
    } else {
      console.warn(`[routes] SKIP ${prefix}: arquivo não encontrado (${fileRelPath})`);
    }
  } catch (e) {
    console.error(`[routes] Falha ao montar ${prefix} (${fileRelPath}):`, e.message);
  }
}

// Monte SOMENTE o que existir no seu src/
tryMount('/api/operations', './api/operationRoutes');    // lista/paginação de operações
tryMount('/api/dashboard',  './api/dashboardRoutes');    // KPIs do dashboard (se tiver)
tryMount('/api/reports',    './api/reportsRoutes');      // geração de relatórios
tryMount('/api/aliases',    './api/aliasesRoutes');      // gerenciador de apelidos
tryMount('/api/analytics',  './api/analyticsRoutes');    // KPIs/diário do período
tryMount('/api/emails',     './api/emailsRoutes');       // envio de e-mail diário
tryMount('/api/users',      './api/userRoutes');         // usuários (se existir)
tryMount('/api/clients',    './api/clientRoutes');       // clientes (se existir)
tryMount('/api/embarcador', './api/embarcadorRoutes');   // embarcadores (se existir)

// ============================ Webhook simples do Assistente ========================
app.post('/api/df/webhook', async (req, res) => {
  try {
    const query = (req.body?.queryResult?.queryText || req.body?.query || '').trim();

    const fulfillmentText = query
      ? `Entendi sua pergunta: "${query}". Vou buscar os dados e te retorno!`
      : 'Oi! Como posso ajudar no rastreamento?';

    return res.json({ fulfillmentText });
  } catch (e) {
    console.error('[df-webhook] erro:', e);
    return res.json({ fulfillmentText: 'Tive um problema ao processar a requisição.' });
  }
});

// ================================= Health / Root ==================================
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa ✅'));

// 404 JSON para qualquer /api não atendida
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// ================================= Error Handler ==================================
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno' });
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ================================== Start =========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));

module.exports = app;