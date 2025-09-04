// src/server.js
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');
const path        = require('path');
const admin       = require('firebase-admin');

const app = express();

/* ============================ Firebase Admin ============================ */
(function initFirebaseAdmin() {
  try {
    if (admin.apps.length) return;

    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (svcJson) {
      const creds = JSON.parse(svcJson);
      admin.initializeApp({ credential: admin.credential.cert(creds) });
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

/* ============================ Middlewares base ============================ */
/** Importante: evita o erro do express-rate-limit e não deixa trust proxy “permissivo” */
app.set('trust proxy', 'loopback'); // (era true)

/** CORS: permite origens definidas em env; se vazio, permite todas */
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // browsers que não enviam origin
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true
}));

/** Preflight amplo para evitar 204/erro em OPTIONS */
app.options('*', cors());

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/** Rate limit “hardened” (evita o ValidationError do pacote) */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // chave para não estourar com trust proxy
});
app.use('/api/', limiter);

/* ======================== Montagem tolerante de rotas ===================== */
function tryMount(prefix, relPathFromSrc) {
  try {
    const full = require.resolve(path.join(__dirname, relPathFromSrc));
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const router = require(full);
    app.use(prefix, router);
    console.log(`[routes] Mounted ${prefix} -> ${path.relative(__dirname, full)}`);
  } catch (e) {
    console.warn(`[routes] SKIP ${prefix}: ${relPathFromSrc} (${e.code || e.message})`);
  }
}

tryMount('/api/operations', './api/operationRoutes');
tryMount('/api/dashboard',  './api/dashboardRoutes');
tryMount('/api/reports',    './api/reportsRoutes');
tryMount('/api/aliases',    './api/aliasesRoutes');
tryMount('/api/analytics',  './api/analyticsRoutes');
tryMount('/api/emails',     './api/emailsRoutes');
tryMount('/api/users',      './api/userRoutes');    // agora calcula admin com ENV
tryMount('/api/clients',    './api/clientRoutes');
tryMount('/api/embarcador', './api/embarcadorRoutes');

/* ========== Fallback mínimo de /api/users/me (mesma regra de admin) ========== */
function computeIsAdmin(decoded) {
  const email = (decoded.email || '').toLowerCase();

  const LIST = (process.env.ADMIN_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const DOMAINS = (process.env.ADMIN_DOMAINS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim().replace(/^@/, ''))
    .filter(Boolean);

  const viaClaim =
    decoded.admin === true ||
    decoded.role === 'admin' ||
    decoded.is_admin === true;

  const viaEmail  = LIST.includes(email);
  const viaDomain = email && DOMAINS.some(d => email.endsWith(`@${d}`));

  return Boolean(viaClaim || viaEmail || viaDomain);
}

async function verifyBearer(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!idToken) return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ message: 'Não autorizado: Token inválido.', detail: e.message });
  }
}

app.get('/api/users/me', verifyBearer, (req, res) => {
  const u = req.user || {};
  const isAdmin = computeIsAdmin(u);

  res.json({
    uid: u.uid,
    email: u.email || null,
    name: u.name || u.displayName || null,
    admin: isAdmin
  });
});

/* ================= Webhook simples do Assistente (opcional) ============== */
app.post('/api/df/webhook', async (req, res) => {
  try {
    const query = (req.body?.queryResult?.queryText || req.body?.query || '').trim();
    const fulfillmentText = query
      ? `Entendi sua pergunta: "${query}". Vou buscar os dados e te retorno!`
      : 'Oi! Como posso ajudar no rastreamento?';
    res.json({ fulfillmentText });
  } catch (e) {
    console.error('[df-webhook] erro:', e);
    res.json({ fulfillmentText: 'Tive um problema ao processar a requisição.' });
  }
});

/* ================================ Health/Root ============================= */
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa ✅'));

/* ========== 404 JSON p/ qualquer /api não atendida (evita HTML) ========== */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

/* =============================== Error Handler ============================ */
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno' });
});

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException',  (e) => console.error('[uncaughtException]',  e));

/* ================================== Start ================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));

module.exports = app;