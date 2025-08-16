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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});