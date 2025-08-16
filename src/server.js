const express = require('express');
const cors = require('cors');
require('dotenv').config();

const userRoutes = require('./api/userRoutes');
const operationRoutes = require('./api/operationRoutes');
const embarcadorRoutes = require('./api/embarcadorRoutes');
const dashboardRoutes = require('./api/dashboardRoutes');
const clientRoutes = require('./api/clientRoutes');

const app = express();

// Middlewares essenciais
app.use(cors()); // Permite requisições de outras origens (seu front-end)
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// Rota de teste para verificar se o servidor está no ar
app.get('/', (req, res) => {
  res.send('API de Rastreamento de Cargas no ar! 🚀');
});

// DIZER AO APP PARA USAR A ROTA
app.use('/api/users', userRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/embarcadores', embarcadorRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/client', clientRoutes);

app.post('/api/webhook/dialogflow', async (req, res) => {
  // segurança por token (se estiver usando)
  if (process.env.DF_TOKEN) {
    const got = req.get('x-dialogflow-token');
    if (got !== process.env.DF_TOKEN) {
      return res.status(401).json({ fulfillmentText: 'Unauthorized' });
    }
  }

  const intentName = (req.body?.queryResult?.intent?.displayName || '').replace(/\s+/g, '');
  const p = req.body?.queryResult?.parameters || {};

  // pega valores de booking/container independente do "name" que usou na intent
  const booking = (p.booking || p.booking_code || p['booking-code'] || '').toString().trim();
  const containerRaw = (p.container || p.container_code || p['container-code'] || '').toString().trim();
  const container = containerRaw.replace(/\s|-/g, ''); // normaliza

  if (intentName === 'RastrearCarga') {
    if (!booking && !container) {
      return res.json({ fulfillmentText: 'Me diga o *booking* ou o número do *container* para eu rastrear 🙂' });
    }

    try {
      // EXEMPLO de consulta: adapte aos seus nomes de tabela/coluna
      const sql = `
        SELECT emb.nome_principal AS embarcador, op.status_operacao,
               op.previsao_inicio_atendimento, op.dt_inicio_execucao, op.dt_fim_execucao,
               op.dt_previsao_entrega_recalculada, op.booking, op.containers, op.tipo_programacao
        FROM operacoes op
        JOIN embarcadores emb ON op.embarcador_id = emb.id
        WHERE ($1 <> '' AND op.booking ILIKE $1)
           OR ($2 <> '' AND REPLACE(REPLACE(op.containers,'-',''),' ','') ILIKE $2)
        ORDER BY op.id DESC
        LIMIT 3;
      `;
      const values = [
        booking ? `%${booking}%` : '',
        container ? `%${container}%` : ''
      ];
      const { rows } = await db.query(sql, values);

      if (!rows.length) {
        return res.json({ fulfillmentText: 'Não encontrei essa carga. Confere o código pra mim?' });
      }

      const fmt = (d) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
      const lines = rows.map(r =>
        `• ${r.tipo_programacao} — ${r.status_operacao || 'Sem status'}\n` +
        `  Embarcador: ${r.embarcador}\n` +
        `  Booking: ${r.booking} | Container(s): ${r.containers}\n` +
        `  Prev/Execução: ${fmt(r.dt_inicio_execucao || r.previsao_inicio_atendimento || r.dt_previsao_entrega_recalculada)}`
      );
      return res.json({ fulfillmentText: `Aqui está o que encontrei:\n\n${lines.join('\n\n')}` });

    } catch (e) {
      console.error('RastrearCarga error:', e);
      return res.json({ fulfillmentText: 'Deu algo errado por aqui. Tenta de novo, por favor 🙏' });
    }
  }

  // fallback genérico para outras intents
  const intentOriginal = req.body?.queryResult?.intent?.displayName || '';
  return res.json({ fulfillmentText: `Recebi a intent: ${intentOriginal || 'desconhecida'}` });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});