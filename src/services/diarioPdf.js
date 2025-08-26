// src/services/diarioPdf.js
// Gera PDF "Diário de Bordo" com capa, KPIs, comparativos mensais, Top 10 atrasos e Comentários.
// Opcional: refino do texto dos comentários via Gemini (LLM_ENABLED=true, LLM_PROVIDER=gemini, GEMINI_API_KEY, LLM_MODEL).

const PDFDocument = require('pdfkit');
const xlsx = require('xlsx');

// =================================== Utilidades de dados ===================================
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

const pickCol = (row, aliases) => {
  if (!row) return null;
  const keys = Object.keys(row);
  for (const k of keys) {
    const nk = norm(k);
    if (aliases.some(a => nk.includes(a))) return k;
  }
  return null;
};

function readSheet(buf) {
  const wb = xlsx.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(ws, { defval: null });
}

function monthKey(v) {
  const d = new Date(v || Date.now());
  if (Number.isNaN(d.getTime())) return 'Indef.';
  return `${String(d.getFullYear())}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function groupCount(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort(); // [['2025-03', 10], ...]
}

function computeMetrics(base, extra) {
  const first = base[0] || {};
  const cCliente = pickCol(first, ['cliente','razao','tomador','dest','remet']);
  const cStatus  = pickCol(first, ['status','situacao']);
  const cTipo    = pickCol(first, ['tipo','operacao','modal','processo']); // coleta/entrega
  const cData    = pickCol(first, ['data','emissao','saida','coleta','entrega']);
  const cAtraso  = pickCol(first, ['atras','atraso','dias_atraso','delay','dias de atraso', 'dias atraso']);
  const total = base.length;

  const porStatus = {};
  const porTipo = {};
  const atrasados = [];

  for (const r of base) {
    const s = cStatus ? (r[cStatus] ?? 'Indefinido') : 'Indefinido';
    porStatus[s] = (porStatus[s] || 0) + 1;

    const t = cTipo ? (r[cTipo] ?? 'Outros') : 'Outros';
    porTipo[t] = (porTipo[t] || 0) + 1;

    const atras = Number(r[cAtraso]);
    if (!Number.isNaN(atras) && atras > 0) atrasados.push({ ...r, __atraso: atras });
  }

  const porMesTotal   = groupCount(base, r => monthKey(cData ? r[cData] : null));
  const porMesColeta  = groupCount(base.filter(r => norm(r[cTipo]||'').includes('colet')), r => monthKey(cData ? r[cData] : null));
  const porMesEntrega = groupCount(base.filter(r => norm(r[cTipo]||'').includes('entreg')), r => monthKey(cData ? r[cData] : null));

  const topAtrasos = atrasados
    .sort((a,b) => b.__atraso - a.__atraso)
    .slice(0, 10)
    .map(r => ({
      cliente: cCliente ? r[cCliente] : '',
      status:  cStatus  ? r[cStatus]  : '',
      atraso:  r.__atraso
    }));

  const atrasoPct = total ? Math.round((atrasados.length / total) * 100) : 0;

  return {
    total, porStatus, porTipo, atrasoPct, topAtrasos,
    porMesTotal, porMesColeta, porMesEntrega
  };
}

// =================================== Desenho no PDF ===================================
function drawHeader(doc, cliente, periodo) {
  // Faixa superior
  doc.rect(0, 0, doc.page.width, 70).fill('#1f3a8a');
  doc.fillColor('#ffffff').fontSize(18).text('DIÁRIO DE BORDO', 36, 20, { continued: true });
  doc.fontSize(18).text(` — ${cliente || 'Cliente'}`);
  doc.fontSize(10).text(periodo || '', 36, 44);
  // reset cor
  doc.fillColor('#000000');
  doc.moveDown();
}

function drawKPIs(doc, metrics, yStart=90) {
  const cards = [
    { label: 'Operações', value: metrics.total },
    { label: 'Atrasos (%)', value: `${metrics.atrasoPct}%` },
    { label: 'Status distintos', value: Object.keys(metrics.porStatus).length },
    { label: 'Tipos distintos', value: Object.keys(metrics.porTipo).length }
  ];

  const W = (doc.page.width - 72) / 4 - 10;
  let x = 36;
  const y = yStart;

  cards.forEach(c => {
    // card
    doc.roundedRect(x, y, W, 48, 8).fill('#f3f4f6').stroke('#e5e7eb');
    // textos
    doc.fillColor('#6b7280').fontSize(10).text(c.label, x+10, y+8, { width: W-20 });
    doc.fillColor('#111827').fontSize(18).text(String(c.value), x+10, y+22, { width: W-20 });
    doc.fillColor('#000000');
    x += W + 10;
  });
}

function drawBars(doc, title, series) {
  doc.moveDown().fontSize(12).text(title).moveDown(0.3);
  const x0 = 36, W = doc.page.width - 72;
  const y0 = doc.y, H = 120;

  // moldura
  doc.rect(x0, y0, W, H).stroke('#e5e7eb');

  const max = Math.max(1, ...series.map(s => Number(s[1]) || 0));
  const barW = Math.max(8, Math.min(40, (W - 20) / Math.max(1, series.length) - 8));
  let x = x0 + 10;

  doc.fontSize(8);
  for (const [label, vRaw] of series) {
    const val = Number(vRaw) || 0;
    const h = Math.round((val / max) * (H - 30));
    // barra
    doc.rect(x, y0 + H - 20 - h, barW, h).fill('#93c5fd').stroke('#60a5fa');
    // valor
    doc.fillColor('#374151').text(String(val), x, y0 + H - 18, { width: barW, align: 'center' });
    // rótulo (mês)
    doc.fillColor('#6b7280').text(String(label).slice(2), x - 6, y0 + H - 10 + 6, { width: barW + 12, align: 'center' });
    doc.fillColor('#000000');
    x += barW + 8;
  }
  doc.moveDown();
}

function drawList(doc, title, items) {
  doc.moveDown().fontSize(12).text(title, { underline: true }).moveDown(0.3);
  doc.fontSize(10).fillColor('#111111');
  items.forEach(t => doc.text('• ' + t));
  doc.fillColor('#000000');
  doc.moveDown();
}

function drawTable(doc, title, rows, columns) {
  doc.moveDown().fontSize(12).text(title).moveDown(0.3);

  const startX = 36;
  let startY = doc.y;
  const rowH = 18;
  const widths = columns.map(c => c.w);
  const totalW = widths.reduce((a,b)=>a+b,0);

  // header
  doc.rect(startX, startY, totalW, rowH).fill('#e5e7eb');
  let x = startX;
  doc.fillColor('#111827').fontSize(10);
  for (const c of columns) {
    doc.text(c.header, x + 6, startY + 5, { width: c.w - 12, ellipsis: true });
    x += c.w;
  }
  doc.fillColor('#000000');

  // rows
  let y = startY + rowH;
  rows.forEach((r, i) => {
    if (y + rowH > (doc.page.height - 50)) {
      doc.addPage();
      y = 50;
    }
    if (i % 2 === 1) {
      doc.rect(startX, y, totalW, rowH).fill('#f9fafb');
      doc.fillColor('#000000');
    }
    let xx = startX;
    for (const c of columns) {
      const v = c.map ? c.map(r) : r[c.key];
      doc.fontSize(10).fillColor('#111111').text(String(v ?? ''), xx + 6, y + 5, { width: c.w - 12, ellipsis: true });
      xx += c.w;
    }
    doc.fillColor('#000000');
    y += rowH;
  });

  doc.moveDown();
}

// ================================ Narrativa / Comentários ================================
async function buildNarrativeHeuristic(metrics, cliente) {
  const obs = [];

  if (metrics.atrasoPct >= 20) {
    obs.push(`Atrasos elevados (${metrics.atrasoPct}%). Recomendamos reforçar follow-up, checagem de janela e revisão de gargalos.`);
  } else if (metrics.atrasoPct > 0) {
    obs.push(`Atrasos sob controle (${metrics.atrasoPct}%). Manter rotinas de confirmação pré-coleta e janela de entrega.`);
  } else {
    obs.push('Sem atrasos registrados no período.');
  }

  const topStatus = Object.entries(metrics.porStatus)
    .sort((a,b)=>b[1]-a[1]).slice(0,2)
    .map(([s,n])=>`${s} (${n})`).join(', ');
  if (topStatus) obs.push(`Maiores volumes por status: ${topStatus}.`);

  const tipos = Object.entries(metrics.porTipo)
    .sort((a,b)=>b[1]-a[1]).map(([t,n])=>`${t} (${n})`);
  if (tipos.length) obs.push(`Distribuição por tipo: ${tipos.join(', ')}.`);

  return `Resumo do período para ${cliente}:\n- ${obs.join('\n- ')}`;
}

// ----- LLM (Gemini) opcional -----
async function llmRefineWithGemini(text, metrics) {
  const enabled = process.env.LLM_ENABLED === 'true';
  if (!enabled) return text;
  if ((process.env.LLM_PROVIDER || 'gemini').toLowerCase() !== 'gemini') return text;
  if (!process.env.GEMINI_API_KEY) return text;

  const model = process.env.LLM_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = {
    contents: [{
      role: 'user',
      parts: [{
        text:
`Reescreva o texto abaixo como um comentário executivo para cliente corporativo de logística,
com tom objetivo e claro, mantendo os números e sem inventar dados. Liste de 3 a 6 bullets
com destaques e finalize com 2 ações recomendadas. Texto base:

${text}`
      }]
    }],
    generationConfig: { temperature: 0.3, topP: 0.9 }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let refined = text;
  try {
    const j = await r.json();
    refined = j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  } catch (_) { /* mantém heurístico */ }

  return refined;
}

// =================================== Builder principal ===================================
async function buildDiarioPDF({ cliente, periodo, baseBuf, extraBuf }) {
  // Lê planilhas
  const base = readSheet(baseBuf);
  const extra = extraBuf ? readSheet(extraBuf) : [];

  // Calcula métricas
  const metrics = computeMetrics(base, extra);

  // Inicia PDF
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));

  // Capa / header
  drawHeader(doc, cliente, periodo);

  // KPIs
  drawKPIs(doc, metrics);

  // Comparativos mensais
  drawBars(doc, 'Comparativo Mensal — Total', metrics.porMesTotal);
  drawBars(doc, 'Comparativo Mensal — Coleta', metrics.porMesColeta);
  drawBars(doc, 'Comparativo Mensal — Entrega', metrics.porMesEntrega);

  // Top 10 atrasos
  const cols = [
    { header:'Cliente', key:'cliente', w: 230 },
    { header:'Status',  key:'status',  w: 150 },
    { header:'Atraso (dias)', key:'atraso', w: 120 },
  ];
  drawTable(doc, 'Top 10 atrasos', metrics.topAtrasos, cols);

  // Página de comentários
  doc.addPage();
  doc.fontSize(12).fillColor('#000000').text('Comentários e Recomendações', { underline: true });
  let narrative = await buildNarrativeHeuristic(metrics, cliente);
  try {
    narrative = await llmRefineWithGemini(narrative, metrics);
  } catch (_) { /* mantém heurística em falha de LLM */ }

  doc.moveDown(0.5).fontSize(10).fillColor('#111111').text(narrative, { align: 'justify' });
  doc.fillColor('#000000');

  // Finaliza
  doc.end();
  return Buffer.concat(chunks);
}

module.exports = { buildDiarioPDF };