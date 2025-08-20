// src/controllers/reportsController.js
const PDFDocument = require('pdfkit');
const { pool } = require('../database'); // seu database.js já exporta pool
const { sendMail } = require('../utils/mailer');

// Util: converte buffer do PDF
function buildPdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

// ====== Consultas base (ajuste nomes/colunas se precisar) ======
async function fetchKpis(clientId, start, end) {
  const sql = `
    select
      count(*)::int                                  as total_operacoes,
      count(*) filter (where status_operacao ilike 'ON TIME')::int as operacoes_on_time,
      count(*) filter (where status_operacao ilike 'ATRAS%')::int   as operacoes_atrasadas
    from operacoes
    where ($1::int is null or embarcador_id = $1::int)
      and (previsao_inicio_atendimento::date between $2::date and $3::date)
  `;
  const { rows } = await pool.query(sql, [clientId || null, start, end]);
  const r = rows[0] || { total_operacoes: 0, operacoes_on_time: 0, operacoes_atrasadas: 0 };
  const pct = r.total_operacoes ? Math.round((r.operacoes_atrasadas / r.total_operacoes) * 100) : 0;
  return { ...r, percentual_atraso: pct };
}

async function fetchTopOffenders(clientId, start, end, limit = 10) {
  const sql = `
    select coalesce(embarcador_nome, 'N/A') as embarcador,
           count(*) filter (where status_operacao ilike 'ATRAS%')::int as atrasos,
           count(*)::int as total
    from operacoes
    where ($1::int is null or embarcador_id = $1::int)
      and (previsao_inicio_atendimento::date between $2::date and $3::date)
    group by 1
    order by atrasos desc nulls last, total desc
    limit $4
  `;
  const { rows } = await pool.query(sql, [clientId || null, start, end, limit]);
  return rows;
}

// Narração textual simples (substitua por LLM depois)
function buildNarrative(kpis, offenders, start, end) {
  const { total_operacoes, operacoes_on_time, operacoes_atrasadas, percentual_atraso } = kpis;
  const top = offenders.slice(0, 3).map(o => `${o.embarcador} (${o.atrasos})`).join(', ') || '—';
  return `
Período: ${start} a ${end}
Total de operações: ${total_operacoes}
On Time: ${operacoes_on_time}
Atrasadas: ${operacoes_atrasadas} (${percentual_atraso}%)

Principais ofensores de atraso: ${top}

Pontos de atenção:
- Priorizar follow-up com os três principais ofensores;
- Verificar causas recorrentes nas justificativas;
- Ajustar janelas de atendimento nos terminais com maior incidência de atraso.
`.trim();
}

// Gera PDF
async function buildDailyReportPdf(companyId, start, end) {
  const kpis = await fetchKpis(companyId, start, end);
  const offenders = await fetchTopOffenders(companyId, start, end, 10);
  const narrative = buildNarrative(kpis, offenders, start, end);

  const pdf = await buildPdfBuffer((doc) => {
    doc.fontSize(18).text('Diário de Bordo - Operações', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Período: ${start} a ${end}`);
    doc.text(`Empresa: ${companyId || 'Todas'}`);
    doc.moveDown();

    doc.fontSize(14).text('KPIs');
    doc.fontSize(12)
      .text(`Total de operações: ${kpis.total_operacoes}`)
      .text(`On Time: ${kpis.operacoes_on_time}`)
      .text(`Atrasadas: ${kpis.operacoes_atrasadas} (${kpis.percentual_atraso}%)`);
    doc.moveDown();

    doc.fontSize(14).text('Top 10 ofensores de atraso');
    doc.moveDown(0.5);
    offenders.forEach((o, i) => {
      doc.fontSize(12).text(`${i + 1}. ${o.embarcador} — Atrasos: ${o.atrasos} / Total: ${o.total}`);
    });
    doc.moveDown();

    doc.fontSize(14).text('Narrativa / Observações');
    doc.fontSize(12).text(narrative, { align: 'left' });
  });

  return { pdf, kpis, offenders };
}

// ====== HANDLERS ======
exports.getDailyReport = async (req, res) => {
  try {
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;
    const start = req.query.start || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const end   = req.query.end   || new Date().toISOString().slice(0, 10);
    const emailTo = req.query.emailTo || process.env.REPORT_DEFAULT_TO || null;

    const { pdf, kpis, offenders } = await buildDailyReportPdf(companyId, start, end);

    // salva histórico
    await pool.query(
      `insert into report_history (company_id, period_start, period_end, totals, offenders)
       values ($1, $2, $3, $4, $5)`,
      [companyId || 0, start, end, kpis, offenders]
    );

    // envia email (opcional)
    if (emailTo) {
      await sendMail({
        to: emailTo,
        subject: `Diário de Bordo (${start} a ${end})`,
        html: `<p>Segue em anexo o relatório do período <strong>${start}</strong> a <strong>${end}</strong>.</p>`,
        attachments: [{ filename: `diario_${start}_a_${end}.pdf`, content: pdf }]
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="diario_${start}_a_${end}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('getDailyReport error:', err);
    res.status(500).json({ error: 'Falha ao gerar relatório.' });
  }
};

exports.webhookNewFile = async (req, res) => {
  try {
    // payload esperado: { companyId, filename, source }
    const { companyId, source } = req.body || {};
    // aqui você pode disparar sua rotina de ingestão (CSV/Excel) e, ao final:
    const start = new Date(Date.now() - 24 * 864e5).toISOString().slice(0, 10);
    const end   = new Date().toISOString().slice(0, 10);
    const { pdf } = await buildDailyReportPdf(companyId ? Number(companyId) : null, start, end);

    // exemplo: só retorna ok (ou enviar e-mail automático)
    res.json({ ok: true, bytes: pdf.length });
  } catch (err) {
    console.error('webhookNewFile error:', err);
    res.status(500).json({ error: 'Falha no webhook.' });
  }
};