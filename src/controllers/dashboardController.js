// src/controllers/dashboardController.js
const db = require('../config/database');

/* ---------------- introspecção simples (cache) ---------------- */
const cache = { opCols: null };

async function getOpCols() {
  if (cache.opCols) return cache.opCols;
  try {
    const q = await db.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'operacoes'
    `);
    cache.opCols = new Set(q.rows.map(r => r.column_name));
  } catch {
    cache.opCols = new Set();
  }
  return cache.opCols;
}

const pickCol = (colsSet, list) => list.find(c => colsSet.has(c)) || null;

/* ---------------- filtros do front -> WHERE/params ---------------- */
function buildWhereAndParams(q = {}) {
  const { companyId, booking, start, end } = q;
  const where = [];
  const params = [];
  let i = 1;

  if (companyId) { where.push(`op.embarcador_id = $${i++}`); params.push(companyId); }
  if (booking)   { where.push(`op.booking ILIKE $${i++}`);   params.push(`%${booking}%`); }
  if (start)     { where.push(`op.previsao_inicio_atendimento::date >= $${i++}`); params.push(start); }
  if (end)       { where.push(`op.previsao_inicio_atendimento::date <= $${i++}`); params.push(end); }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/* ---------------- condição de atraso resiliente ---------------- */
function buildAtrasoCond(C) {
  const parts = [];
  if (C.has('tempo_atraso')) parts.push(`COALESCE(op.tempo_atraso,0) > 0`);
  if (C.has('situacao_prazo_programacao'))
    parts.push(`COALESCE(op.situacao_prazo_programacao,'') ILIKE '%atras%'`);
  if (C.has('dt_inicio_execucao') && C.has('previsao_inicio_atendimento')) {
    parts.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento)`);
    parts.push(`(op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW())`);
  }
  return parts.length ? parts.map(p => `(${p})`).join(' OR ') : 'FALSE';
}

/* ---------------- SELECT da lista conforme colunas ---------------- */
function buildOperationsSelect(C, clientExpr, portExpr) {
  const asTxt = c => (C.has(c) ? `op.${c}::text` : `NULL::text`);
  const asVal = c => (C.has(c) ? `op.${c}`      : `NULL`);

  let atrasoExpr = `'00:00'::text`;
  if (C.has('atraso_hhmm') && C.has('tempo_atraso')) {
    atrasoExpr = `COALESCE(NULLIF(op.atraso_hhmm,''), lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0'), '00:00')`;
  } else if (C.has('atraso_hhmm')) {
    atrasoExpr = `COALESCE(NULLIF(op.atraso_hhmm,''), '00:00')`;
  } else if (C.has('tempo_atraso')) {
    atrasoExpr = `lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0')`;
  }

  let motivoExpr = `NULL::text`;
  if (C.has('justificativa_atraso') && C.has('motivo_atraso')) {
    motivoExpr = `COALESCE(NULLIF(op.justificativa_atraso,''), op.motivo_atraso)`;
  } else if (C.has('justificativa_atraso')) {
    motivoExpr = `NULLIF(op.justificativa_atraso,'')`;
  } else if (C.has('motivo_atraso')) {
    motivoExpr = `op.motivo_atraso`;
  }

  return `
    op.booking AS booking,
    ${C.has('containers') ? 'op.containers' : 'NULL::text'} AS container,
    ${clientExpr} AS client,
    ${portExpr}   AS port,
    ${asTxt('previsao_inicio_atendimento')} AS sla_previsao,
    ${asTxt('dt_inicio_execucao')}          AS exec_inicio,
    ${asTxt('dt_fim_execucao')}             AS exec_fim,
    ${atrasoExpr}                           AS atraso_hhmm,
    ${motivoExpr}                           AS motivo,
    ${asVal('tipo_operacao')}               AS tipo_operacao,
    ${asVal('transportadora')}              AS transportadora,
    ${asVal('numero_programacao')}          AS num_programacao,
    ${asVal('nome_motorista')}              AS motorista,
    ${asVal('cpf_motorista')}               AS cpf,
    ${asVal('placa_veiculo')}               AS placa_veiculo,
    ${asVal('placa_carreta')}               AS placa_carreta,
    ${asVal('numero_cliente')}              AS numero_cliente
  `;
}

/* ============================ Handlers ============================ */
exports.getKpis = async (req, res) => {
  try {
    const C = await getOpCols();
    const { where, params } = buildWhereAndParams(req.query);

    // coluna de cliente (ordem de preferência conforme CSVs comuns)
    const clientCol = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    const clientExpr = clientCol ? `op."${clientCol}"` : `NULL::text`;

    const atrasoCond = buildAtrasoCond(C);

    const total = parseInt((await db.query(`SELECT COUNT(*) FROM operacoes op ${where}`, params)).rows[0].count, 10) || 0;
    const late  = parseInt((await db.query(
      `SELECT COUNT(*) FROM operacoes op ${where ? where + ' AND ' + atrasoCond : 'WHERE ' + atrasoCond}`, params
    )).rows[0].count, 10) || 0;

    const onTime = Math.max(total - late, 0);
    const latePct = total > 0 ? Number(((late / total) * 100).toFixed(2)) : 0;

    const offRows = (await db.query(
      `SELECT
         ${C.has('justificativa_atraso') ? `NULLIF(op.justificativa_atraso,'')` : 'NULL'} AS j,
         ${C.has('motivo_atraso') ? 'op.motivo_atraso' : 'NULL'} AS m,
         COUNT(*)::int AS count
       FROM operacoes op
       ${where ? where + ' AND ' : 'WHERE '} (${atrasoCond})
       GROUP BY j, m
       ORDER BY count DESC
       LIMIT 10`, params
    )).rows;

    const topOffenders = offRows.map(r => ({ reason: r.j || r.m || 'Sem justificativa', count: r.count }));

    const clientsRows = (await db.query(
      `SELECT ${clientExpr} AS client, COUNT(op.id)::int AS count
         FROM operacoes op
        ${where ? where + ' AND ' : 'WHERE '} (${atrasoCond})
        GROUP BY ${clientExpr}
        ORDER BY count DESC
        LIMIT 10`, params
    )).rows;

    res.json({
      total, onTime, late, latePct,
      topOffenders,
      topClients: clientsRows.map(r => ({ client: r.client || 'Sem cliente', count: r.count }))
    });
  } catch (e) {
    console.error('getKpis error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getCompanies = async (_req, res) => {
  try {
    const C = await getOpCols();
    const clientCol = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    if (!clientCol) return res.json([]);

    const rows = (await db.query(
      `SELECT DISTINCT op."${clientCol}" AS name
         FROM operacoes op
        WHERE op."${clientCol}" IS NOT NULL AND op."${clientCol}" <> ''
        ORDER BY op."${clientCol}" ASC`
    )).rows;

    res.json(rows.map((r, i) => ({ id: -1 * (i + 1), name: r.name })));
  } catch (e) {
    console.error('getCompanies error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getOperations = async (req, res) => {
  try {
    const C = await getOpCols();
    const { where, params } = buildWhereAndParams(req.query);

    const clientCol = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    const clientExpr = clientCol ? `op."${clientCol}"` : `NULL::text`;

    const portCol = pickCol(C, ['porto','pol','pod','port']);
    const portExpr = portCol ? `op."${portCol}"` : `NULL::text`;

    const selectList = buildOperationsSelect(C, clientExpr, portExpr);

    const rows = (await db.query(
      `SELECT ${selectList}
         FROM operacoes op
        ${where}
        ORDER BY op.previsao_inicio_atendimento DESC NULLS LAST
        LIMIT 1000`,
      params
    )).rows;

    res.json({ items: rows });
  } catch (e) {
    console.error('getOperations error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getPendingUsers = async (_req, _res) => _res.json([]);