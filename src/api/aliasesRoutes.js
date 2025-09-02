const express = require('express');
const router = express.Router();
const { listAliases, upsertAlias, ensureTable } = require('../controllers/aliasesController');

ensureTable().catch(console.error);

// GET /api/aliases
router.get('/', async (req,res) => {
  try {
    const rows = await listAliases();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao listar aliases' });
  }
});

// POST /api/aliases { alias, master }
router.post('/', async (req,res) => {
  try {
    const { alias, master } = req.body || {};
    if (!alias || !master) return res.status(400).json({ error: 'alias e master são obrigatórios' });
    const row = await upsertAlias(alias, master);
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao salvar alias' });
  }
});

module.exports = router;