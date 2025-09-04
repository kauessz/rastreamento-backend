// src/controllers/dashboardController.js
const db = require('../config/database');

/** ======== util: introspecção do schema (com cache) ======== */
let cache = {
  embTableExists: null,
  embNameCol: null,              // 'nome' | 'nome_principal' | 'name' | null
  opCols: null                   // Set com nomes de colunas da tabela 'operacoes'
};

async function tableExists(schema, table) {
  const q = await db.query(
    `SELECT to_regclass($1) AS reg`,
    [`${schema}.${table}`]
  );
  return !!(q.rows[0] && q.rows[0].reg);
}

async function getColumns(table) {
  const q = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(q.rows.map(r => r.column_name));
}

async function ensureMeta() {
  if (cache.opCols === null) {
    try { cache.opCols = await getColumns('operacoes'); }
    catch { cache.opCols = new Set(); }
  }
  if (cache.embTableExists === null) {
    try { cache.embTableExists = await tableExists('public', 'embarcadores'); }
    catch { cache.embTableExists = false; }
  }
  if (cache.embTableExists && cache.embNameCol === null) {
    try {
      const q = await db.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='embarcadores'
            AND column_name IN ('nome','nome_principal','name','razao_social')
          ORDER BY CASE column_name
                     WHEN 'nome' THEN 1
                     WHEN 'nome_principal' THEN 2
                     WHEN 'name' THEN 3
                     WHEN 'razao_social' THEN 4
                   END
          LIMIT 1`
      );
      cache.embNameCol = q.rows[0]?.column_name ?? null;
    } catch { cache.embNameCol = null; }
  }
}

/** ======== filtros do front -> WHERE/params ======== */
function buildWhereAndParams(q = {}) {
  const { companyId, booking, start, end } = q;
  const clauses = [];
  const params = [];
  let i = 1;

  if (companyId) { clauses.push(`op.embarcador_id = $${i++}`); params.push(companyId); }
  if (booking)   { clauses.push(`op.booking ILIKE $${i++}`);   params.push(`%${booking}%`); }
  if (start)     { clauses.push(`op.previsao_inicio_atendimento::date >= $${i++}`); params.push(start); }
  if (end)       { clauses.push(`op.previsao_inicio_atendimento::date <= $${i++}`); params.push(end); }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** ======== monta expressão de cliente e JOIN conforme schema ======== */
function buildClientExprAndJoin() {
  const { embTableExists, embNameCol } = cache;

  if (embTableExists && embNameCol) {
    return {
      clientExpr: `COALESCE(emb."${embNameCol}", op.nome_embarcador)`,
      joinEmb: `LEFT JOIN embarcadores emb ON emb.id = op.embarcador_id`
    };
  }
  return { clientExpr: `op.nome_embarcador`, joinEmb: `` };
}

/** ======== condição de atraso de forma resiliente ======== */
function buildAtrasoCondition() {
  const C = cache.opCols;
  const parts = [];

  if (C.has('tempo_atraso')) {
    parts.push(`COALESCE(op.tempo_atraso,0) > 0`);
  }
  if (C.has('situacao_prazo_programacao')) {
    parts.push(`COALESCE(op.situacao_prazo_programacao,'') ILIKE '%atras%'`);
  }
  if (C.has('dt_inicio_execucao') && C.has('previsao_inicio_atendimento')) {
    parts.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento)`);
    parts.push(`(op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW())`);
  }

  // Se nada existir, evita quebrar
  if (!parts.length) return 'FALSE';
  return parts.map(p => `(${p})`).join(' OR ');
}

/** ======== SELECT de operações (campos que o front renderiza) ======== */
function buildOperationsSelect(clientExpr) {
  const C = cache.opCols;
  const pick = (col, alias, type='text') =>
    C.has(col) ? `op.${col} AS ${alias}` : `NULL::${type} AS ${alias}`;
  const pickTxt = (col, alias) =>
    C.has(col) ? `op.${col}::text AS ${alias}` : `NULL::text AS ${alias}`;

  // atraso HH:MM
  let atrasoExpr = `'00:00'::text`;
  if (C.has('atraso_hhmm') && C.has('tempo_atraso')) {
    atrasoExpr = `COALESCE(NULLIF(op.atraso_hhmm,''), lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0'), '00:00')`;
  } else if (C.has('atraso_hhmm')) {
    atrasoExpr = `COALESCE(NULLIF(op.atraso_hhmm,''), '00:00')`;
  } else if (C.has('tempo_atraso')) {
    atrasoExpr = `lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0')`;
  }

  // motivo
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
    ${C.has('porto') ? 'op.porto' : 'NULL::text'} AS port,
    ${pickTxt('previsao_inicio_atendimento','sla_previsao')},
    ${pickTxt('dt_inicio_execucao','exec_inicio')},
    ${pickTxt('dt_fim_execucao','exec_fim')},
    ${atrasoExpr} AS atraso_hhmm,
    ${motivoExpr} AS motivo,
    ${pick('tipo_operacao','tipo_operacao')},
    ${pick('transportadora','transportadora')},
    ${pick('numero_programacao','num_programacao')},
    ${pick('nome_motorista','motorista')},
    ${pick('cpf_motorista','cpf')},
    ${pick('placa_veiculo','placa_veiculo')},
    ${pick('placa_carreta','placa_carreta')},
    ${pick('numero_cliente','numero_cliente')}
  `;
}

/** ==================== Handlers ==================== */
exports.getKpis = async (req, res) => {
  try {
    await ensureMeta();
    const { where, params } = buildWhereAndParams(req.query);
    const { clientExpr, joinEmb } = buildClientExprAndJoin();
    const atrasoCond = buildAtrasoCondition();

    const totalQ = await db.query(`SELECT COUNT(*) FROM operacoes op ${where}`, params);
    const total = parseInt(totalQ.rows[0].count, 10) || 0;

    const lateQ = await db.query(
      `SELECT COUNT(*) FROM operacoes op ${where ? where + ' AND ' + atrasoCond : 'WHERE ' + atrasoCond}`,
      params
    );
    const late = parseInt(lateQ.rows[0].count, 10) || 0;

    const onTime = Math.max(total - late, 0);
    const latePct = total > 0 ? Number(((late / total) * 100).toFixed(2)) : 0;

    const offQ = await db.query(
      `SELECT
         ${cache.opCols.has('justificativa_atraso') ? `NULLIF(op.justificativa_atraso,'')` : `NULL`} AS j,
         ${cache.opCols.has('motivo_atraso') ? `op.motivo_atraso` : `NULL`} AS m,
         COUNT(*)::int AS count
       FROM operacoes op
       ${where ? where + ' AND ' : 'WHERE '} (${atrasoCond})
       GROUP BY j, m
       ORDER BY count DESC
       LIMIT 10`,
      params
    );
    const topOffenders = offQ.rows.map(r => ({
      reason: r.j || r.m || 'Sem justificativa',
      count: r.count
    }));

    const cliQ = await db.query(
      `SELECT ${clientExpr} AS client, COUNT(op.id)::int AS count
       FROM operacoes op
       ${joinEmb}
       ${where ? where + ' AND ' : 'WHERE '} (${atrasoCond})
       GROUP BY ${clientExpr}
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    res.json({
      total, onTime, late, latePct,
      topOffenders,
      topClients: cliQ.rows.map(r => ({ client: r.client || 'Sem cliente', count: r.count }))
    });
  } catch (e) {
    console.error('getKpis error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getCompanies = async (_req, res) => {
  try {
    await ensureMeta();

    // 1) Se tem tabela embarcadores + coluna de nome, usa como fonte canônica
    if (cache.embTableExists && cache.embNameCol) {
      const rows = (await db.query(
        `SELECT id, "${cache.embNameCol}" AS name
           FROM embarcadores
          ORDER BY "${cache.embNameCol}" ASC`
      )).rows;
      if (rows.length) return res.json(rows);
    }

    // 2) Fallback: distinct do texto em operacoes
    const rows = (await db.query(
      `SELECT DISTINCT nome_embarcador AS name
         FROM operacoes
        WHERE nome_embarcador IS NOT NULL AND nome_embarcador <> ''
        ORDER BY nome_embarcador ASC`
    )).rows;
    return res.json(rows.map((r, i) => ({ id: -1 * (i + 1), name: r.name })));
  } catch (e) {
    console.error('getCompanies error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getOperations = async (req, res) => {
  try {
    await ensureMeta();
    const { where, params } = buildWhereAndParams(req.query);
    const { clientExpr, joinEmb } = buildClientExprAndJoin();

    const selectList = buildOperationsSelect(clientExpr);
    const rows = (await db.query(
      `SELECT
         ${selectList}
       FROM operacoes op
       ${joinEmb}
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

exports.getPendingUsers = async (_req, res) => res.json([]);