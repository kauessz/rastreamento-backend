// src/server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

// ------------------------------
// PATCH: Guardas para paths inválidos (Router e App)
// ------------------------------
(function patchExpressGuards() {
  function wrapRegister(target, label) {
    const methods = ['get','post','put','delete','patch','all','use'];
    methods.forEach((m) => {
      const orig = target[m];
      if (!orig || orig.__guarded) return;
      target[m] = function guarded(firstArg, ...rest) {
        try {
          // app.use(fn) é válido sem path; Router.use(fn) idem.
          const isFn = typeof firstArg === 'function';
          const isObj = firstArg && typeof firstArg === 'object';
          const isRegExp = firstArg instanceof RegExp;
          const isArray = Array.isArray(firstArg);

          // Se veio RegExp/Array/Fn/Obj, não validamos string e seguimos.
          if (!firstArg || isFn || isObj || isRegExp || isArray) {
            return orig.call(this, firstArg, ...rest);
          }

          if (typeof firstArg === 'string') {
            const pth = firstArg;
            // Captura local do chamador (primeira linha sob /src/api/ ou /src/)
            const stack = new Error().stack || '';
            const caller = stack.split('\n').find(l =>
              l.includes(`${path.sep}src${path.sep}api${path.sep}`) ||
              l.includes(`${path.sep}src${path.sep}`)
            );
            const where = caller ? caller.trim() : '(origem não detectada)';

            // 1) URL absoluta (ERRADO)
            if (/^https?:\/\//i.test(pth)) {
              console.error(`❌ [${label}.${m}] Rota com URL ABSOLUTA: "${pth}" em ${where}. NÃO será registrada.`);
              return this; // skip
            }
            // 2) path que não começa com "/"
            if (!pth.startsWith('/')) {
              console.error(`❌ [${label}.${m}] Path inválido (não começa com "/"): "${pth}" em ${where}. NÃO será registrada.`);
              return this; // skip
            }
            // 3) parâmetro sem nome "/:/" ou "/:" no fim
            if (/(^|\/):($|\/)/.test(pth)) {
              console.error(`❌ [${label}.${m}] Parâmetro sem nome no path: "${pth}" em ${where}. Ajuste para "/:id". NÃO será registrada.`);
              return this; // skip
            }
          }
        } catch (e) {
          console.error(`⚠️  Guard de rota falhou (${label}.${m}):`, e);
        }
        return orig.call(this, firstArg, ...rest);
      };
      target[m].__guarded = true;
    });
  }

  // Patch em express.Router() protótipo
  const origRouter = express.Router;
  if (!origRouter.__patched) {
    express.Router = function patchedRouter(...args) {
      const router = origRouter.apply(this, args);
      wrapRegister(router, 'router');
      router.__patched = true;
      return router;
    };
    express.Router.__patched = true;
  }

  // Patch no protótipo da aplicação (app.get/use/…)
  const appProto = require('express/lib/application');
  wrapRegister(appProto, 'app');
})();

// ------------------------------
// App básico
// ------------------------------
const app = express();
app.set('trust proxy', 1);

// CORS
const allowedOrigins = [
  process.env.FRONT_ORIGIN,                 // ex.: https://tracking-r.netlify.app
  'https://tracking-r.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith('netlify.app') || host.endsWith('onrender.com')) return cb(null, true);
    } catch {}
    return cb(new Error(`CORS: origem não permitida: ${origin}`));
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Authorization, Content-Type, X-Requested-With',
  optionsSuccessStatus: 204
}));
app.options('*', cors());

app.use(express.json());

// Health
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('API de Rastreamento ativa 🚀'));

// ------------------------------
// Helpers p/ montagem segura
// ------------------------------
function safeRequire(label, modPath) {
  try {
    const mod = require(modPath);
    return mod;
  } catch (err) {
    console.error(`❌ Falha ao dar require em ${label} (${modPath}):\n`, err && err.stack || err);
    return null;
  }
}
function safeMount(urlPath, modPath) {
  try {
    if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
      console.error(`❌ Path inválido ao montar rotas: "${urlPath}". Deve começar com "/". Ignorando.`);
      return;
    }
    const routes = safeRequire(urlPath, modPath);
    if (!routes) return;
    const ok = typeof routes === 'function' || (routes && typeof routes.use === 'function');
    if (!ok) {
      console.error(`❌ Módulo de rotas não exporta um Router válido: ${modPath}`);
      return;
    }
    app.use(urlPath, routes);
    console.log(`✅ Rotas montadas em ${urlPath} ← ${modPath}`);
  } catch (err) {
    console.error(`❌ Erro ao montar ${urlPath} (${modPath}):\n`, err && err.stack || err);
  }
}

// ------------------------------
// Webhook Dialogflow (igual ao seu, enxuto)
// ------------------------------
const db = require('./config/database');

function toBR(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } }
function getBaseUrl(req) { return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`; }
function sanitizeContainer(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const CONTAINER_RE = /([A-Za-z]{4}\s*-?\s*\d{3}\s*-?\s*\d{4})/i;

function parseSession(req) {
  const sessionPath = req.body?.session || '';
  const sessionId = sessionPath.split('/').pop() || '';
  const [role = 'client', companyStr = '0'] = sessionId.split(':');
  const companyId = Number(companyStr) || 0;
  return { role, companyId, sessionId };
}
function companyFilter(alias, nextParamIndex, role, companyId) {
  if (role === 'client' && companyId > 0) {
    return { clause: ` AND ${alias}.embarcador_id = $${nextParamIndex}`, value: companyId };
  }
  return { clause: '', value: null };
}
function dfButton(link, text) {
  return {
    payload: { richContent: [[{ type: 'button', text, link, icon: { type: 'chevron_right' } }]] }
  };
}

const dfHandler = async (req, res) => {
  try {
    if (process.env.DF_TOKEN) {
      const got = req.get('x-dialogflow-token');
      if (got !== process.env.DF_TOKEN) {
        return res.status(401).json({ fulfillmentText: 'Unauthorized' });
      }
    }

    const { role, companyId } = parseSession(req);
    const intentName = (req.body?.queryResult?.intent?.displayName || '').replace(/\s+/g, '');
    const p = req.body?.queryResult?.parameters || {};
    const booking   = (p.booking || p.booking_code || p['booking-code'] || '').toString().trim();
    const contRaw   = (p.container || p.container_code || p['container-code'] || '').toString().trim();
    const container = sanitizeContainer(contRaw);

    if (intentName === 'Ping') return res.json({ fulfillmentText: 'Webhook OK! ✅' });

    if (intentName === 'RastrearCarga') {
      if (!booking && !container) {
        return res.json({ fulfillmentText: 'Me diga o *booking* ou o número do *container* para eu rastrear 🙂' });
      }
      const filter = companyFilter('op', 3, role, companyId);
      const sql = `
        SELECT emb.nome_principal AS embarcador, op.status_operacao,
               op.previsao_inicio_atendimento, op.dt_inicio_execucao, op.dt_fim_execucao,
               op.dt_previsao_entrega_recalculada, op.booking, op.containers, op.tipo_programacao
          FROM operacoes op
          JOIN embarcadores emb ON op.embarcador_id = emb.id
         WHERE (($1 <> '' AND op.booking ILIKE $1)
             OR  ($2 <> '' AND REPLACE(REPLACE(op.containers,'-',''),' ','') ILIKE $2))
               ${filter.clause}
        ORDER BY op.id DESC
        LIMIT 3;`;
      const params = [ booking ? `%${booking}%` : '', container ? `%${container}%` : '' ];
      if (filter.value !== null) params.push(filter.value);
      const { rows } = await db.query(sql, params);
      if (!rows.length) return res.json({ fulfillmentText: 'Não encontrei essa carga. Confere o código pra mim?' });

      const lines = rows.map(r => {
        const pre = r.previsao_inicio_atendimento ? new Date(r.previsao_inicio_atendimento).toLocaleString('pt-BR') : 'N/A';
        const ini = r.dt_inicio_execucao ? new Date(r.dt_inicio_execucao).toLocaleString('pt-BR') : 'N/A';
        const fim = r.dt_fim_execucao ? new Date(r.dt_fim_execucao).toLocaleString('pt-BR') : 'N/A';
        const rec = r.dt_previsao_entrega_recalculada ? new Date(r.dt_previsao_entrega_recalculada).toLocaleString('pt-BR') : 'N/A';
        return `• **${r.tipo_programacao} — ${r.status_operacao}**
Embarcador: ${r.embarcador}
Booking: ${r.booking} | Contêiner(es): ${r.containers}
Prev/Atend: ${pre}
Início: ${ini} | Fim: ${fim}
Prev. Entrega (recalc): ${rec}`;
      });
      return res.json({ fulfillmentText: `Aqui está o que encontrei:\n\n${lines.join('\n\n')}` });
    }

    if (intentName === 'TopOfensores') {
      const period = p['date-period'] || {};
      const start = period.startDate || new Date(Date.now() - 30 * 864e5).toISOString();
      const end = period.endDate || new Date().toISOString();
      const params = [start, end];
      const filt = companyFilter('op', params.length + 1, role, companyId);
      if (filt.value !== null) params.push(filt.value);

      const q = `
        SELECT emb.nome_principal AS embarcador, COUNT(*) AS qtd
        FROM operacoes op
        JOIN embarcadores emb ON op.embarcador_id = emb.id
        WHERE op.previsao_inicio_atendimento BETWEEN $1 AND $2
          AND (
            (op.dt_inicio_execucao > op.previsao_inicio_atendimento)
            OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW())
          )
        ${filt.clause}
        GROUP BY 1
        ORDER BY qtd DESC
        LIMIT 10;`;
      const { rows } = await db.query(q, params);
      if (!rows.length) return res.json({ fulfillmentText: `Top 10 (${toBR(start)}–${toBR(end)}): sem atrasos 👏` });
      const txt = rows.map((r, i) => `${i + 1}. ${r.embarcador}: ${r.qtd}`).join('\n');
      const base = getBaseUrl(req);
      const link = `${base}/api/reports/top-ofensores.xlsx?start=${start.slice(0,10)}&end=${end.slice(0,10)}${(role==='client'&&companyId)?`&companyId=${companyId}`:''}`;
      return res.json({
        fulfillmentText: `Top 10 (${toBR(start)}–${toBR(end)}):\n${txt}`,
        fulfillmentMessages: [dfButton(link, 'Baixar Excel (Top 10)')]
      });
    }

    if (intentName === 'RelatorioPeriodo') {
      const period = p['date-period'] || {};
      const start = period.startDate || new Date(Date.now() - 30 * 864e5).toISOString();
      const end = period.endDate || new Date().toISOString();
      const tipo = (p.report_type || 'atrasos').toString();

      if (tipo === 'atrasos') {
        const params = [start, end];
        const filt = companyFilter('op', params.length + 1, role, companyId);
        if (filt.value !== null) params.push(filt.value);
        const q = `
          SELECT COUNT(*) FILTER (WHERE op.dt_inicio_execucao > op.previsao_inicio_atendimento) AS iniciadas_atrasadas,
                 COUNT(*) FILTER (WHERE op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()) AS nao_iniciadas_atrasadas,
                 COUNT(*) AS total
          FROM operacoes op
          WHERE op.previsao_inicio_atendimento BETWEEN $1 AND $2
          ${filt.clause};`;
        const { rows } = await db.query(q, params);
        const r = rows[0] || { iniciadas_atrasadas: 0, nao_iniciadas_atrasadas: 0, total: 0 };
        const base = getBaseUrl(req);
        const link = `${base}/api/reports/atrasos.xlsx?start=${start.slice(0,10)}&end=${end.slice(0,10)}${(role==='client'&&companyId)?`&companyId=${companyId}`:''}`;
        return res.json({
          fulfillmentText:
            `Resumo ${toBR(start)}–${toBR(end)}:\n` +
            `• Iniciadas com atraso: ${r.iniciadas_atrasadas}\n` +
            `• Não iniciadas e vencidas: ${r.nao_iniciadas_atrasadas}\n` +
            `• Total: ${r.total}`,
          fulfillmentMessages: [dfButton(link, 'Baixar Excel (Resumo de Atrasos)')]
        });
      }

      return res.json({ fulfillmentText: 'Relatório ainda não implementado. Tente “atrasos” ou “top ofensores”.' });
    }

    const original = req.body?.queryResult?.intent?.displayName || '';
    return res.json({ fulfillmentText: `Recebi a intent: ${original || 'desconhecida'}` });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.json({ fulfillmentText: 'Erro no webhook.' });
  }
};

app.post('/webhook/dialogflow', dfHandler);
app.post('/api/webhook/dialogflow', dfHandler); // alias

// ------------------------------
// Montagem das rotas (cada uma com try/catch + logs)
// ------------------------------
function mountAll() {
  [
    ['/api/users',        './api/userRoutes'],
    ['/api/operations',   './api/operationRoutes'],
    ['/api/embarcadores', './api/embarcadorRoutes'],
    ['/api/dashboard',    './api/dashboardRoutes'],
    ['/api/client',       './api/clientRoutes'],
    ['/api/reports',      './api/reportsRoutes'],
    // Se recriar IA depois: ['/api/ai', './api/aiRoutes'],
  ].forEach(([base, mod]) => safeMount(base, mod));
}
mountAll();

// 404 + handler de erro
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('🔥 Unhandled error:', err && err.stack || err);
  res.status(500).json({ error: 'Internal error' });
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));