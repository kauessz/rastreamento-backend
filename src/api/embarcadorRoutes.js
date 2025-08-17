// Em: src/api/embarcadorRoutes.js

const express = require('express');
const router = express.Router();
const embarcadorController = require('../controllers/embarcadorController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

// Rota para buscar a lista de embarcadores mestres (para os filtros)
router.get('/', authMiddleware, isAdmin, embarcadorController.getAllEmbarcadores);

// Rota para buscar todos os apelidos
router.get('/aliases', authMiddleware, isAdmin, embarcadorController.listAliases);

// Rota para reassociar um apelido
router.put('/aliases/:aliasId/reassign', authMiddleware, isAdmin, embarcadorController.reassignAlias);

// Rota para apagar um apelido
router.delete('/aliases/:aliasId', authMiddleware, isAdmin, embarcadorController.deleteAlias);

module.exports = router;