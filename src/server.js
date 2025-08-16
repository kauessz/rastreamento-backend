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

// ✅ Webhook do Dialogflow (rota simples inline)
app.post('/api/webhook/dialogflow', (req, res) => {
  // (opcional) segurança por token: defina DF_TOKEN no Render e envie o mesmo no header x-dialogflow-token
  const expected = process.env.DF_TOKEN;
  if (expected) {
    const got = req.get('x-dialogflow-token') || '';
    if (got !== expected) {
      return res.status(401).json({ fulfillmentText: 'Unauthorized' });
    }
  }

  // pega o nome da intent
  const intent = req.body?.queryResult?.intent?.displayName || '';

  // teste rápido
  if (intent === 'Ping') {
    return res.json({ fulfillmentText: 'Webhook OK! ✅' });
  }

  // resposta padrão
  return res.json({ fulfillmentText: `Recebi a intent: ${intent || 'desconhecida'}` });
});

// healthcheck opcional
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});