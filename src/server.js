// src/server.js
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');
const admin       = require('firebase-admin');

// ============ Firebase Admin (token do mesmo projeto do front!) ============
(function initFirebaseAdmin() {
  try {
    // Suporta tanto FIREBASE_SERVICE_ACCOUNT (JSON inteiro)
    // quanto as variáveis separadas (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)
    let cred;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      cred = admin.credential.cert(json);
    } else {
      const projectId  = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      // Render/Netlify guardam \n escapado — corrigimos:
      const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

      if (!projectId || !clientEmail || !privateKey) {
        console.warn('[auth] Variáveis do Firebase incompletas.');
      }
      cred = admin.credential.cert({ projectId, clientEmail, privateKey });
    }

    admin.initializeApp({ credential: cred });
    console.log('[auth] Firebase Admin inicializado.');
  } catch (err) {
    console.error('[auth] Falha ao iniciar Firebase Admin:', err);
  }
})();

// ============================ App / Middleware =============================
const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(morgan('tiny'));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate-limit simples (ajuste se precisar)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);

// =============================== CORS (fix) ================================
// IMPORTANTE: nada de app.options('*', …) no Express 5.
// Usamos cors() com origin dinâmico + resposta manual para OPTIONS.
const allowedOrigins = [
  process.env.FRONT_ORIGIN,                 // ex.: https://tracking-r.netlify.app
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

function originOk(origin) {
  if (!origin) return true; // chamadas server-to-server
  if (allowedOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    // libera “*.netlify.app” e “*.onrender.com” por comodidade
    if (hostname.endsWith('.netlify.app')) return true;
    if (hostname.endsWith('.onrender.com')) return true;
  } catch {}
  return false;
}

app.use(
  cors({
    origin: (origin, cb) => cb(null, originOk(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// Resposta curta às preflights sem usar app.options('*', …)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ================================ Rotas ====================================
// Middlewares e rotas do projeto
const userRoutes        = require('./api/userRoutes');
const operationRoutes   = require('./api/operationRoutes');
const embarcadorRoutes  = require('./api/embarcadorRoutes');
const clientRoutes      = require('./api/clientRoutes');
const dashboardRoutes   = require('./api/dashboardRoutes');
const reportsRoutes     = require('./api/reportsRoutes');

// Montagem
app.use('/api/users',        userRoutes);
app.use('/api/operations',   operationRoutes);
app.use('/api/embarcadores', embarcadorRoutes);
app.use('/api/client',       clientRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/reports',      reportsRoutes);

// ====================== Webhook Dialogflow (Messenger) =====================
// Se você usa o Dialogflow Messenger (iframe) no front, esse webhook
// recebe intents e devolve respostas simples (ajuste à sua lógica).
app.post('/api/dialogflow/webhook', async (req, res) => {
  try {
    const query = req.body?.queryResult?.queryText || '';
    // Exemplo mínimo — aqui você pode chamar seu banco, etc.
    const fulfillmentText = query
      ? `Entendi sua pergunta: "${query}". Vou buscar os dados e te retorno!`
      : 'Oi! Como posso ajudar no rastreamento?';

    return res.json({ fulfillmentText });
  } catch (e) {
    console.error('[df-webhook] erro:', e);
    return res.json({ fulfillmentText: 'Tive um problema ao processar a requisição.' });
  }
});

// ================================ Health ===================================
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa ✅'));

// ================================ Start ====================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));

module.exports = app;