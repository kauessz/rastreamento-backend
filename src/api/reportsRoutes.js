const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportsController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin        = require('../middlewares/adminMiddleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const { buildDiarioPDF } = require('../services/diarioPdf'); // novo serviço
const nodemailer = require('nodemailer'); // para enviar e-mails

// Gera o PDF do Diário de Bordo a partir de duas planilhas (mini-IA do front)
router.post('/diario-de-bordo',
  authMiddleware, isAdmin,
  upload.fields([{ name: 'fonte', maxCount: 1 }, { name: 'informacoes', maxCount: 1 }]),
  async (req, res) => {
    try {
      if (!req.files?.fonte?.[0] || !req.files?.informacoes?.[0]) {
        return res.status(400).json({ message: 'Envie as duas planilhas: "fonte" e "informacoes".' });
      }
      const start = req.body.start || '';
      const end = req.body.end || '';
      const cliente = (req.body.cliente || '').replace(/.*cliente\s+/i,'').trim();
      const periodo = `Período: ${start} a ${end}`;

      const pdf = await buildDiarioPDF({
        cliente,
        periodo,
        baseBuf: req.files.fonte[0].buffer,
        extraBuf: req.files.informacoes[0].buffer,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="diario_de_bordo_${start}_a_${end}.pdf"`);
      res.send(pdf);
    } catch (err) {
      console.error('[diario-de-bordo]', err);
      res.status(500).json({ message: 'Falha ao gerar PDF.' });
    }
  }
);

// Dispara e-mails do resumo de atrasos (acionado após clicar no botão Atrasos no front)
router.post('/atrasos/send-emails', authMiddleware, isAdmin, async (req, res) => {
  try {
    const { start, end, companyId = 0 } = req.body || {};
    // TODO: troque por consulta real na sua base:
    const recipients = (process.env.RECIPIENTS || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (!recipients.length) return res.json({ ok: true, sent: 0, note: 'Sem destinatários cadastrados.' });

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
      // attachments: [ ... se quiser anexar o .xlsx real ]
    });

    res.json({ ok: true, sent: recipients.length });
  } catch (err) {
    console.error('[atrasos/send-emails]', err);
    res.status(500).json({ message: 'Falha ao enviar e-mails.' });
  }
});


// Admin-only
router.get('/daily',               authMiddleware, isAdmin, reports.getDailyReport);
router.get('/top-ofensores.xlsx',  authMiddleware, isAdmin, reports.topOffendersExcel);
router.get('/atrasos.xlsx',        authMiddleware, isAdmin, reports.resumoAtrasosExcel);

// Webhook (se quiser, proteja com token via header)
router.post('/hooks/new-file', reports.webhookNewFile);

module.exports = router;
