// server.js — atualizado com escopo por empresa via session-id do Dialogflow Messenger
// Express + CORS + Webhook Dialogflow + rotas da API

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// DB (Pool do Postgres / Supabase)
const db = require('./config/database');

// Rotas existentes da sua API (ajuste os paths se forem diferentes no seu projeto)
const userRoutes = require('./api/userRoutes');
const operationRoutes = require('./api/operationRoutes');
const embarcadorRoutes = require('./api/embarcadorRoutes');
const dashboardRoutes = require('./api/dashboardRoutes');
const clientRoutes = require('./api/clientRoutes');

const app = express();

// Middlewares básicos
app.use(cors());
app.use(express.json()); // necessário para ler req.body JSON

// (Opcional) log simples de requisições
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// -----------------------------
// Helpers
// -----------------------------
function toBR(iso) {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}

// Lê o session-id enviado pelo Dialogflow Messenger
// Formato esperado no front:
//  - cliente: "client:<companyId>:<email>"
//  - admin:   "admin:0:<email>"
function parseSession(req) {
  const sessionPath = req.body?.session || ''; // ex: projects/xxx/agent/sessions/client:123:usuario
  const sessionId = sessionPath.split('/').pop() || '';
  const [role = 'client', companyStr = '0'] = sessionId.split(':');
  const companyId = Number(companyStr) || 0;
  return { role, companyId, sessionId };
}

// Monta cláusula de filtro por empresa quando for cliente
function companyFilter(alias, nextParamIndex, role, companyId) {
  if (role === 'client' && companyId > 0) {
    return { clause: ` AND ${alias}.embarcador_id = $${nextParamIndex}`, value: companyId };
  }
  return { clause: '', value: null };
}

// -----------------------------
// Webhook do Dialogflow
// -----------------------------
const dfHandler = async (req, res) => {
  try {
    // Segurança simples por token (defina DF_TOKEN no Render e envie o mesmo no header x-dialogflow-token)
    if (process.env.DF_TOKEN) {
      const got = req.get('x-dialogflow-token');
      if (got !== process.env.DF_TOKEN) {
        return res.status(401).json({ fulfillmentText: 'Unauthorized' });
      }
    }

    // Pega role/companyId do session-id
    const { role, companyId } = parseSession(req);

    const intentName = (req.body?.queryResult?.intent?.displayName || '').replace(/\s+/g, '');
    const p = req.body?.queryResult?.parameters || {};

    // Normalização dos parâmetros usuais
    const booking = (p.booking || p.booking_code || p['booking-code'] || '').toString().trim();
    const containerRaw = (p.container || p.container_code || p['container-code'] || '').toString().trim();
    const container = containerRaw.replace(/\s|-/g, '');

    // Health intent (teste)
    if (intentName === 'Ping') {
      return res.json({ fulfillmentText: 'Webhook OK! ✅' });
    }

    // -----------------
    // RastrearCarga (booking OU container) com filtro por empresa quando cliente
    // -----------------
    if (intentName === 'RastrearCarga') {
      if (!booking && !container) {
        return res.json({ fulfillmentText: 'Me diga o *booking* ou o número do *container* para eu rastrear 🙂' });
      }
      try {
        const params = [];
        const likeBooking = booking ? `%${booking}%` : '';
        const likeContainer = container ? `%${container}%` : '';
        params.push(likeBooking, likeContainer);

        const filt = companyFilter('op', params.length + 1, role, companyId);
        if (filt.value !== null) params.push(filt.value);

        const sql = `
          SELECT emb.nome_principal AS embarcador, op.status_operacao,
                 op.previsao_inicio_atendimento, op.dt_inicio_execucao, op.dt_fim_execucao,
                 op.dt_previsao_entrega_recalculada, op.booking, op.containers, op.tipo_programacao
          FROM operacoes op
          JOIN embarcadores emb ON op.embarcador_id = emb.id
          WHERE (
            ($1 <> '' AND op.booking ILIKE $1)
            OR ($2 <> '' AND REPLACE(REPLACE(op.containers,'-',''),' ','') ILIKE $2)
          )
          ${filt.clause}
          ORDER BY op.id DESC
          LIMIT 3;`;

        const { rows } = await db.query(sql, params);

        if (!rows.length) {
          return res.json({ fulfillmentText: 'Não encontrei essa carga. Confere o código pra mim?' });
        }

        const fmt = (d) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
        const lines = rows.map(r => (
          `• ${r.tipo_programacao} — ${r.status_operacao || 'Sem status'}\n` +
          `  Embarcador: ${r.embarcador}\n` +
          `  Booking: ${r.booking} | Container(s): ${r.containers}\n` +
          `  Prev/Execução: ${fmt(r.dt_inicio_execucao || r.previsao_inicio_atendimento || r.dt_previsao_entrega_recalculada)}`
        ));

        return res.json({ fulfillmentText: `Aqui está o que encontrei:\n\n${lines.join('\n\n')}` });
      } catch (e) {
        console.error('RastrearCarga error:', e);
        return res.json({ fulfillmentText: 'Deu algo errado por aqui. Tenta de novo, por favor 🙏' });
      }
    }

    // -----------------
    // TopOfensores — com filtro por empresa quando cliente
    // -----------------
    if (intentName === 'TopOfensores') {
      const period = p['date-period'] || {};
      const start = period.startDate || new Date(Date.now() - 30 * 864e5).toISOString();
      const end   = period.endDate   || new Date().toISOString();

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
      if (!rows.length) return res.json({ fulfillmentText: 'Sem atrasos no período 👏' });
      const txt = rows.map((r, i) => `${i + 1}. ${r.embarcador}: ${r.qtd}`).join('\n');
      return res.json({ fulfillmentText: `Top 10 (${toBR(start)}–${toBR(end)}):\n${txt}` });
    }

    // -----------------
    // RelatorioPeriodo (tipo "atrasos") — com filtro por empresa quando cliente
    // -----------------
    if (intentName === 'RelatorioPeriodo') {
      const period = p['date-period'] || {};
      const start = period.startDate || new Date(Date.now() - 30 * 864e5).toISOString();
      const end   = period.endDate   || new Date().toISOString();
      const tipo  = (p.report_type || 'atrasos').toString();

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
        return res.json({ fulfillmentText:
          `Resumo ${toBR(start)}–${toBR(end)}:\n• Iniciadas com atraso: ${r.iniciadas_atrasadas}\n• Não iniciadas e vencidas: ${r.nao_iniciadas_atrasadas}\n• Total: ${r.total}` });
      }

      return res.json({ fulfillmentText: 'Relatório ainda não implementado. Tente “atrasos” ou “top ofensores”.' });
    }

    // Fallback: ecoa a intent recebida
    const intentOriginal = req.body?.queryResult?.intent?.displayName || '';
    return res.json({ fulfillmentText: `Recebi a intent: ${intentOriginal || 'desconhecida'}` });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.json({ fulfillmentText: 'Erro no webhook.' });
  }
};

// Expor as duas URLs (evita 404 por caminho diferente)
app.post('/api/webhook/dialogflow', dfHandler);
app.post('/webhook/dialogflow', dfHandler);

// -----------------------------
// Demais rotas da sua API
// -----------------------------
app.use('/api/users', userRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/embarcadores', embarcadorRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/client', clientRoutes);

// Healthcheck
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Subir servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
