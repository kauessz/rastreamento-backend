// src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Pool do Postgres
const db = require('./config/database');

// Rotas
const userRoutes        = require('./api/userRoutes');
const operationRoutes   = require('./api/operationRoutes');
const embarcadorRoutes  = require('./api/embarcadorRoutes');
const dashboardRoutes   = require('./api/dashboardRoutes');
const clientRoutes      = require('./api/clientRoutes');

const app = express();
app.set('trust proxy', 1);

// CORS liberal (frontend Netlify + Messenger)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// log simples
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// -----------------------------
// helpers
// -----------------------------
function toBR(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } }
function fmtFull(iso) { try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso || '—'; } }

// monta a base pública para links absolutos
function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// normaliza container removendo tudo que não for letra/número
function sanitizeContainer(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const CONTAINER_RE = /([A-Za-z]{4}\s*-?\s*\d{3}\s*-?\s*\d{4})/i;

// session-id do Dialogflow Messenger:
// - cliente: client:<companyId>:<email>
// - admin:   admin:0:<email>
function parseSession(req) {
  const sessionPath = req.body?.session || ''; // projects/.../sessions/client:123:user
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

// botão (richContent) para Dialogflow Messenger
function dfButton(link, text) {
  return {
    payload: {
      richContent: [[
        { type: 'button', text, link, icon: { type: 'chevron_right' } }
      ]]
    }
  };
}

// -----------------------------
// Webhook Dialogflow
// -----------------------------
const dfHandler = async (req, res) => {
  try {
    // auth opcional por header
    if (process.env.DF_TOKEN) {
      const got = req.get('x-dialogflow-token');
      if (got !== process.env.DF_TOKEN) {
        return res.status(401).json({ fulfillmentText: 'Unauthorized' });
      }
    }

    const { role, companyId } = parseSession(req);
    const intentName = (req.body?.queryResult?.intent?.displayName || '').replace(/\s+/g, '');
    const p = req.body?.queryResult?.parameters || {};

    // parâmetros normalizados para booking/container
    const booking   = (p.booking || p.booking_code || p['booking-code'] || '').toString().trim();
    const contRaw   = (p.container || p.container_code || p['container-code'] || '').toString().trim();
    const container = sanitizeContainer(contRaw);

    // health
    if (intentName === 'Ping') {
      return res.json({ fulfillmentText: 'Webhook OK! ✅' });
    }

    // -----------------
    // RastrearCarga
    // -----------------
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
        LIMIT 3;
      `;
      const params = [
        booking ? `%${booking}%` : '',
        container ? `%${container}%` : ''
      ];
      if (filter.value !== null) params.push(filter.value);

      const { rows } = await db.query(sql, params);
      if (!rows.length) {
        return res.json({ fulfillmentText: 'Não encontrei essa carga. Confere o código pra mim?' });
      }

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

      return res.json({
        fulfillmentText: `Aqui está o que encontrei:\n\n${lines.join('\n\n')}`
      });
    }


    // -----------------
    // TopOfensores  (texto + botão Excel)
    // -----------------
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
      if (!rows.length) {
        return res.json({ fulfillmentText: `Top 10 (${toBR(start)}–${toBR(end)}): sem atrasos 👏` });
      }

      const txt = rows.map((r, i) => `${i + 1}. ${r.embarcador}: ${r.qtd}`).join('\n');
      const base = getBaseUrl(req);
      const link = `${base}/api/reports/top-ofensores.xlsx?start=${start.slice(0, 10)}&end=${end.slice(0, 10)}${(role === 'client' && companyId) ? `&companyId=${companyId}` : ''}`;

      return res.json({
        fulfillmentText: `Top 10 (${toBR(start)}–${toBR(end)}):\n${txt}`,
        fulfillmentMessages: [dfButton(link, 'Baixar Excel (Top 10)')]
      });
    }

    // -----------------
    // RelatorioPeriodo (tipo: atrasos)  (texto + botão Excel)
    // -----------------
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
        const link = `${base}/api/reports/atrasos.xlsx?start=${start.slice(0, 10)}&end=${end.slice(0, 10)}${(role === 'client' && companyId) ? `&companyId=${companyId}` : ''}`;

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

    // -----------------
    // PLANO B: detectar container/booking no texto quando nenhuma intent casa
    // -----------------
    try {
      const qtext = (req.body?.queryResult?.queryText || '').trim();

      // tenta detectar container; se não houver, tenta algo que pareça booking
      const mCont = qtext.match(CONTAINER_RE);                                 // ex.: TLLU4449470 | TLLU 444 9470
      const mBook = qtext.match(/(?:\bbooking\s*)?([A-Za-z0-9-]{6,20})/i);      // ex.: P10474544

      const container2 = mCont ? sanitizeContainer(mCont[1]) : '';
      const booking2 = (!mCont && mBook) ? mBook[1] : '';

      // se não achou nada mesmo, deixa cair no fallback padrão
      if (!container2 && !booking2) {
        // não retorna aqui: deixa seguir para o fallback padrão do webhook
      } else {
        const params2 = [
          booking2 ? `%${booking2}%` : '',
          container2 ? `%${container2}%` : ''
        ];
        const filt2 = companyFilter('op', params2.length + 1, role, companyId);
        if (filt2.value !== null) params2.push(filt2.value);

        const sql2 = `
          SELECT emb.nome_principal AS embarcador, op.status_operacao,
                op.previsao_inicio_atendimento, op.dt_inicio_execucao, op.dt_fim_execucao,
                op.dt_previsao_entrega_recalculada, op.booking, op.containers, op.tipo_programacao
          FROM operacoes op
          JOIN embarcadores emb ON op.embarcador_id = emb.id
          WHERE (
            ($1 <> '' AND op.booking ILIKE $1)
            OR ($2 <> '' AND regexp_replace(op.containers, '[^A-Za-z0-9]', '', 'g') ILIKE $2)
          )
          ${filt2.clause}
          ORDER BY op.id DESC
          LIMIT 3;`;

        const { rows } = await db.query(sql2, params2);

        if (rows.length) {
          const fmt = (d) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
          const lines = rows.map(r =>
            `• ${r.tipo_programacao} — ${r.status_operacao || 'Sem status'}\n` +
            `  Embarcador: ${r.embarcador}\n` +
            `  Booking: ${r.booking} | Container(s): ${r.containers}\n` +
            `  Prev/Execução: ${fmt(r.dt_inicio_execucao || r.previsao_inicio_atendimento || r.dt_previsao_entrega_recalculada)}`
          );
          return res.json({ fulfillmentText: `Aqui está o que encontrei:\n\n${lines.join('\n\n')}` });
        }

        // não encontrou nada -> responde de forma amigável
        return res.json({ fulfillmentText: 'Não encontrei essa carga. Confere o código?' });
      }
    } catch (e) {
      console.error('Plano B (fallback detect) error:', e);
      // se der erro, deixa cair no fallback padrão logo abaixo
    }


    // fallback padrão
    const intentOriginal = req.body?.queryResult?.intent?.displayName || '';
    return res.json({ fulfillmentText: `Recebi a intent: ${intentOriginal || 'desconhecida'}` });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.json({ fulfillmentText: 'Erro no webhook.' });
  }
};

// rotas do webhook
app.post('/webhook/dialogflow', dfHandler);

// -----------------------------
// Endpoints Excel
// -----------------------------
app.get('/api/reports/top-ofensores.xlsx', async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString();
    const end = req.query.end ? new Date(req.query.end).toISOString() : new Date().toISOString();
    const companyId = Number(req.query.companyId || 0);

    const params = [start, end];
    let clause = '';
    if (companyId) { clause = ' AND op.embarcador_id = $3'; params.push(companyId); }

    const q = `
      SELECT emb.nome_principal AS embarcador, COUNT(*) AS qtd
      FROM operacoes op
      JOIN embarcadores emb ON op.embarcador_id = emb.id
      WHERE op.previsao_inicio_atendimento BETWEEN $1 AND $2
        AND (
          (op.dt_inicio_execucao > op.previsao_inicio_atendimento)
          OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW())
        )
      ${clause}
      GROUP BY 1
      ORDER BY qtd DESC
      LIMIT 10;`;

    const { rows } = await db.query(q, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Top Ofensores');
    ws.columns = [
      { header: 'Posição', key: 'pos', width: 10 },
      { header: 'Embarcador', key: 'embarcador', width: 40 },
      { header: 'Qtd Atrasos', key: 'qtd', width: 15 },
      { header: 'Período', key: 'periodo', width: 25 },
    ];
    rows.forEach((r, i) => ws.addRow({ pos: i + 1, embarcador: r.embarcador, qtd: r.qtd, periodo: `${start.slice(0, 10)} a ${end.slice(0, 10)}` }));
    ws.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="top-ofensores_${start.slice(0, 10)}_${end.slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('excel top-ofensores', e);
    res.status(500).send('Erro ao gerar Excel');
  }
});

app.get('/api/reports/atrasos.xlsx', async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString();
    const end = req.query.end ? new Date(req.query.end).toISOString() : new Date().toISOString();
    const companyId = Number(req.query.companyId || 0);

    const params = [start, end];
    let clause = '';
    if (companyId) { clause = ' AND op.embarcador_id = $3'; params.push(companyId); }

    const q = `
      SELECT COUNT(*) FILTER (WHERE op.dt_inicio_execucao > op.previsao_inicio_atendimento) AS iniciadas_atrasadas,
             COUNT(*) FILTER (WHERE op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()) AS nao_iniciadas_atrasadas,
             COUNT(*) AS total
      FROM operacoes op
      WHERE op.previsao_inicio_atendimento BETWEEN $1 AND $2
      ${clause};`;

    const { rows } = await db.query(q, params);
    const r = rows[0] || { iniciadas_atrasadas: 0, nao_iniciadas_atrasadas: 0, total: 0 };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Resumo Atrasos');
    ws.columns = [
      { header: 'Período', key: 'periodo', width: 25 },
      { header: 'Iniciadas com atraso', key: 'ini', width: 22 },
      { header: 'Não iniciadas e vencidas', key: 'nao', width: 28 },
      { header: 'Total', key: 'total', width: 10 },
    ];
    ws.addRow({ periodo: `${start.slice(0, 10)} a ${end.slice(0, 10)}`, ini: r.iniciadas_atrasadas, nao: r.nao_iniciadas_atrasadas, total: r.total });
    ws.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="atrasos_${start.slice(0, 10)}_${end.slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('excel atrasos', e);
    res.status(500).send('Erro ao gerar Excel');
  }
});

// endpoint do webhook
app.post('/api/webhook/dialogflow', dfHandler);

// ============= Rotas da API existentes =============
app.get('/', (_req, res) => res.send('API de Rastreamento ativa 🚀'));
app.use('/api/users', userRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/embarcadores', embarcadorRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/client', clientRoutes);

// 404 + erro
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API up on :${PORT}`));