// src/api/embarcadorRoutes.js
const express = require('express');
const router = express.Router();

const embarcadorController = require('../controllers/embarcadorController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/adminMiddleware');

// Lista mestres (para popular o <select> e filtros)
router.get('/', authMiddleware, isAdmin, embarcadorController.listMasters);

// Lista aliases (pendentes por padrão; aceita ?only=unassigned|dupe|all&q=texto)
router.get('/aliases', authMiddleware, isAdmin, embarcadorController.listAliases);

// Reassociar um alias a um novo mestre
router.put('/aliases/:id/reassign', authMiddleware, isAdmin, embarcadorController.reassignAlias);

// Excluir um alias
router.delete('/aliases/:id', authMiddleware, isAdmin, embarcadorController.deleteAlias);

module.exports = router;
