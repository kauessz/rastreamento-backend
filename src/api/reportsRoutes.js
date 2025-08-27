// src/api/reportsRoutes.js
const express = require('express');
const router = express.Router();

// rotas antigas (controller existente)
const reports = require('../controllers/reportsController');

// middlewares (caminho correto na sua árvore)
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin        = require('../middlewares/adminMiddleware');

// serviços e libs novas para o Diário de Bordo
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const { buildDiarioPDF } = require('../services/diarioPdf');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');

// ===================== Rotas antigas (mantidas) =====================
router.get('/daily',              authMiddleware, isAdmin, reports.getDailyReport);
router.get('/top-ofensores.xlsx', authMiddleware, isAdmin, reports.topOffendersExcel);
router.get('/atrasos.xlsx',       authMiddleware, isAdmin, reports.resumoAtrasosExcel);

// Webhook (se quiser, proteja com token via header)
router.post('/hooks/new-file', reports.webhookNewFile);

// ===================== Utils para validar cliente nas planilhas =====================
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const rootName = (s) => norm(s)
  .replace(/\b(s\/a|s\.a\.|ltda|me|epp|sa)\b/g, '')
  .replace(/ - .*/g, '')
  .replace(/[^\w\s]/g,' ')
  .replace(/\s+/g,' ')
  .trim();

function sheetToJson(buf) {
  const wb = xlsx.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(ws, { defval: null });
}
function pickCol(row, aliases) {
  if (!row) return null;
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    if (aliases.some(a => nk.includes(a))) return k;
  }
  return null;
}
function findClientColumn(rows) {
  const first = rows[0] || {};
  return pickCol(first, [
    'embarcador','cliente','razao','razao social','tomador',
    'remet','remetente','dest','destinatario'
  ]);
}
function hasClient(rows, col, target) {
  if (!col) return false;
  const tgt = rootName(target);
  return rows.some(r => {
    const v = rootName(r[col] || '');
    return v && (v.includes(tgt) || tgt.includes(v));
  });
}

// ===================== Diário de Bordo (mini-IA) =====================
router.post(
  '/diario-de-bordo',
  authMiddleware, isAdmin,
  upload.fields([{ name: 'fonte', maxCount: 1 }, { name: 'informacoes', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { start = '', end = '', cliente = '' } = req.body || {};

      if (!req.files?.fonte?.[0] || !req.files?.informacoes?.[0]) {
        return res.status(400).json({ error: 'Envie as duas planilhas: "fonte" e "informacoes".' });
      }
      if (!cliente) {
        return res.status(400).json({ error: 'Informe o cliente no comando (ex.: "… do cliente AMBEV").' });
      }

      // Valida se as planilhas pertencem ao embarcador informado
      const base  = sheetToJson(req.files.fonte[0].buffer);
      const extra = sheetToJson(req.files.informacoes[0].buffer);

      const c1 = findClientColumn(base);
      const c2 = findClientColumn(extra);
      const ok = hasClient(base, c1, cliente) || hasClient(extra, c2, cliente);
      if (!ok) {
        const exemplos = []
          .concat(c1 ? base.slice(0,3).map(r => r[c1]).filter(Boolean) : [])
          .concat(c2 ? extra.slice(0,3).map(r => r[c2]).filter(Boolean) : [])
          .map(String);
        return res.status(400).json({
          error: `As planilhas não parecem pertencer ao embarcador "${cliente.toUpperCase()}".`,
          dica: exemplos.length ? `Exemplos encontrados: ${exemplos.join(', ')}` : undefined
        });
      }

      const periodo = `Período: ${start} a ${end}`;
      const pdf = await buildDiarioPDF({
        cliente,
        periodo,
        baseBuf:  req.files.fonte[0].buffer,
        extraBuf: req.files.informacoes[0].buffer,
      });

      res.setHeader('Content-Type', 'application/pdf');
      const fname = `diario_de_bordo_${rootName(cliente)}_${start}_a_${end}.pdf`;
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      return res.send(pdf);
    } catch (err) {
      console.error('[diario-de-bordo]', err);
      return res.status(500).json({ error: 'Falha ao gerar relatório.' });
    }
  }
);

// ===================== Disparo de e-mails de atrasos =====================
router.post('/atrasos/send-emails', authMiddleware, isAdmin, async (req, res) => {
  try {
    const { start, end } = req.body || {};
    const recipients = (process.env.RECIPIENTS || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (!recipients.length) return res.json({ ok: true, sent: 0, note: 'Sem destinatários (RECIPIENTS).' });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `Resumo de Atrasos — ${start} a ${end}`,
      text: `Prezados,\n\nSegue o resumo de atrasos do período ${start} a ${end}.\n\n(Enviado automaticamente.)`
    });

    res.json({ ok: true, sent: recipients.length });
  } catch (err) {
    console.error('[atrasos/send-emails]', err);
    res.status(500).json({ error: 'Falha ao enviar e-mails.' });
  }
});

module.exports = router;