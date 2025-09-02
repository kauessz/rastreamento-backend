const db = require('../database');
const nodemailer = require('nodemailer');

// Transporter via SMTP (defina no .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true para 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false } // útil em ambientes com cert autoassinado
});

const atrasoMinExpr = `
  GREATEST(
    COALESCE(o.tempo_atraso, 0),
    CASE
      WHEN (o.atraso_hhmm IS NOT NULL AND o.atraso_hhmm <> '' AND UPPER(o.atraso_hhmm) <> 'ON TIME')
      THEN SPLIT_PART(o.atraso_hhmm, ':', 1)::int*60 + SPLIT_PART(o.atraso_hhmm, ':', 2)::int
      ELSE 0
    END
  )
`;

exports.sendDailyDelaysEmail = async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().slice(0,10);
    const companyId = req.body.companyId ? Number(req.body.companyId) : null;

    // 1) Busca atrasos do dia
    const sql = `
      SELECT
        COALESCE(o.nome_embarcador, o.embarcador, 'Sem cliente') AS cliente,
        o.booking,
        COALESCE(o.containers, o.container, o.conteiner) AS containers,
        o.previsao_inicio_atendimento,
        COALESCE(o.motivo_atraso, o.motivo_do_atraso, o.motivo) AS motivo_atraso,
        ${atrasoMinExpr} AS atraso_min
      FROM operacoes o
      WHERE DATE(o.previsao_inicio_atendimento) = $1
        AND (${atrasoMinExpr} > 0)
        AND ($2::int IS NULL OR o.company_id = $2)
      ORDER BY cliente ASC, o.previsao_inicio_atendimento ASC;
    `;
    const { rows } = await db.query(sql, [date, companyId]);

    // 2) Monta HTML simples
    const linhas = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.cliente)}</td>
        <td>${escapeHtml(r.booking || '')}</td>
        <td>${escapeHtml(r.containers || '')}</td>
        <td>${formatDate(r.previsao_inicio_atendimento)}</td>
        <td>${escapeHtml(r.motivo_atraso || 'Sem motivo')}</td>
        <td style="text-align:right">${Number(r.atraso_min)} min</td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111">
        <h2 style="margin:0 0 10px">Atrasos do dia ${date}</h2>
        <p>Segue o resumo de operações com atraso registrado na data.</p>
        <table style="border-collapse:collapse;width:100%">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">Cliente</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">Booking</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">Contêiner</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">Previsão</th>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">Motivo</th>
              <th style="text-align:right;border-bottom:1px solid #ddd;padding:6px">Atraso (min)</th>
            </tr>
          </thead>
          <tbody>${linhas || `<tr><td colspan="6" style="padding:8px">Sem atrasos registrados.</td></tr>`}</tbody>
        </table>
        <p style="margin-top:14px;color:#555">Mensagem automática • Rastreamento</p>
      </div>
    `;

    // 3) Destinatários
    let toList = Array.isArray(req.body.to) ? req.body.to : null;
    if (!toList || !toList.length) {
      // Exemplo de busca de destinatários por cliente/empresa (ajuste à sua tabela real)
      // Supondo uma tabela "destinatarios_clientes (email, ativo, company_id)".
      const q = `
        SELECT DISTINCT email
        FROM destinatarios_clientes
        WHERE ativo = true
          AND ($1::int IS NULL OR company_id = $1)
      `;
      const dest = await db.query(q, [companyId]);
      toList = dest.rows.map(r => r.email).filter(Boolean);
    }

    if (!toList || !toList.length) {
      return res.status(400).json({ error: 'Nenhum destinatário encontrado (ou forneça "to" no body).' });
    }

    // 4) Envia
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toList.join(','),
      subject: `Atrasos do dia ${date}`,
      html
    });

    res.json({ ok: true, messageId: info.messageId, sent: toList.length });
  } catch (err) {
    console.error('[emails/daily-delays]', err);
    res.status(500).json({ error: 'Falha ao enviar e-mail diário de atrasos' });
  }
};

// Helpers
function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function formatDate(iso) {
  try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; }
}