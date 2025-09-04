// src/controllers/dashboardController.js
const db = require('../config/database');

// cache de metadados
const cache = { opCols: null, hasEmb: null, embNameCol: null };

async function getOpCols() {
  if (cache.opCols) return cache.opCols;
  try {
    const q = await db.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='operacoes'`);
    cache.opCols = new Set(q.rows.map(r => r.column_name));
  } catch { cache.opCols = new Set(); }
  return cache.opCols;
}
async function tableExists(name){
  const q = await db.query(`SELECT to_regclass($1) reg`, [`public.${name}`]);
  return !!q.rows[0]?.reg;
}
async function colExists(table, col){
  const q = await db.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     LIMIT 1`, [table, col]);
  return q.rowCount>0;
}
async function ensureEmb(){
  if (cache.hasEmb===null) cache.hasEmb = await tableExists('embarcadores');
  if (cache.hasEmb && cache.embNameCol===null){
    const cands = ['nome','nome_principal','name','razao_social','descricao','cliente'];
    for (const c of cands){ // eslint-disable-next-line no-await-in-loop
      if (await colExists('embarcadores', c)){ cache.embNameCol = c; break; }
    }
    if (!cache.embNameCol) cache.embNameCol = 'nome'; // fallback
  }
}

const pickCol = (S, arr) => arr.find(c => S.has(c)) || null;

function buildWhereAndParams(q = {}) {
  const { companyId, booking, start, end } = q;
  const clauses = []; const params = []; let i = 1;
  if (companyId){ clauses.push(`op.embarcador_id = $${i++}`); params.push(companyId); }
  if (booking){   clauses.push(`op.booking ILIKE $${i++}`);   params.push(`%${booking}%`); }
  if (start){     clauses.push(`op.previsao_inicio_atendimento::date >= $${i++}`); params.push(start); }
  if (end){       clauses.push(`op.previsao_inicio_atendimento::date <= $${i++}`); params.push(end); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function atrasoCond(C){
  const P=[];
  if (C.has('tempo_atraso')) P.push(`COALESCE(op.tempo_atraso,0)>0`);
  if (C.has('situacao_prazo_programacao')) P.push(`COALESCE(op.situacao_prazo_programacao,'') ILIKE '%atras%'`);
  if (C.has('dt_inicio_execucao') && C.has('previsao_inicio_atendimento')){
    P.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento)`);
    P.push(`(op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW())`);
  }
  return P.length ? P.map(x=>`(${x})`).join(' OR ') : 'FALSE';
}

function selectOps(C, clientExpr, portExpr){
  const asTxt = c => (C.has(c) ? `op.${c}::text` : `NULL::text`);
  const asVal = c => (C.has(c) ? `op.${c}`      : `NULL`);
  let atraso = `'00:00'::text`;
  if (C.has('atraso_hhmm') && C.has('tempo_atraso'))
    atraso = `COALESCE(NULLIF(op.atraso_hhmm,''), lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0'),'00:00')`;
  else if (C.has('atraso_hhmm')) atraso = `COALESCE(NULLIF(op.atraso_hhmm,''),'00:00')`;
  else if (C.has('tempo_atraso')) atraso = `lpad((op.tempo_atraso/60)::text,2,'0')||':'||lpad((op.tempo_atraso%60)::text,2,'0')`;

  let motivo = `NULL::text`;
  if (C.has('justificativa_atraso') && C.has('motivo_atraso')) motivo = `COALESCE(NULLIF(op.justificativa_atraso,''), op.motivo_atraso)`;
  else if (C.has('justificativa_atraso')) motivo = `NULLIF(op.justificativa_atraso,'')`;
  else if (C.has('motivo_atraso')) motivo = `op.motivo_atraso`;

  return `
    op.booking AS booking,
    ${C.has('containers') ? 'op.containers' : 'NULL::text'} AS container,
    ${clientExpr} AS client,
    ${portExpr} AS port,
    ${asTxt('previsao_inicio_atendimento')} AS sla_previsao,
    ${asTxt('dt_inicio_execucao')} AS exec_inicio,
    ${asTxt('dt_fim_execucao')} AS exec_fim,
    ${atraso} AS atraso_hhmm,
    ${motivo} AS motivo,
    ${asVal('tipo_operacao')} AS tipo_operacao,
    ${asVal('transportadora')} AS transportadora,
    ${asVal('numero_programacao')} AS num_programacao,
    ${asVal('nome_motorista')} AS motorista,
    ${asVal('cpf_motorista')} AS cpf,
    ${asVal('placa_veiculo')} AS placa_veiculo,
    ${asVal('placa_carreta')} AS placa_carreta,
    ${asVal('numero_cliente')} AS numero_cliente
  `;
}

/* ============================ KPIs ============================ */
exports.getKpis = async (req, res) => {
  try {
    await ensureEmb();
    const C = await getOpCols();
    const { where, params } = buildWhereAndParams(req.query);

    const c1 = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    const clientExpr = `COALESCE(${[
      c1 && `op."${c1}"`,
      cache.hasEmb && cache.embNameCol && `NULLIF(e."${cache.embNameCol}",'')`
    ].filter(Boolean).join(', ')}, 'Sem cliente')`;

    const join = (cache.hasEmb && cache.embNameCol && C.has('embarcador_id'))
      ? `LEFT JOIN embarcadores e ON e.id = op.embarcador_id` : ``;

    const A = atrasoCond(C);

    const total = parseInt((await db.query(`SELECT COUNT(*) FROM operacoes op ${where}`, params)).rows[0].count,10)||0;
    const late  = parseInt((await db.query(`SELECT COUNT(*) FROM operacoes op ${where ? where + ' AND ' + A : 'WHERE ' + A}`, params)).rows[0].count,10)||0;
    const onTime = Math.max(total-late,0);
    const latePct = total>0 ? Number(((late/total)*100).toFixed(2)) : 0;

    const off = (await db.query(
      `SELECT
         ${C.has('justificativa_atraso') ? `NULLIF(op.justificativa_atraso,'')` : 'NULL'} AS j,
         ${C.has('motivo_atraso') ? 'op.motivo_atraso' : 'NULL'} AS m,
         COUNT(*)::int AS count
       FROM operacoes op
       ${join}
       ${where ? where + ' AND ' : 'WHERE ' } (${A})
       GROUP BY j,m
       ORDER BY count DESC
       LIMIT 10`, params
    )).rows.map(r => ({ reason: r.j || r.m || 'Sem justificativa', count: r.count }));

    const topClients = (await db.query(
      `SELECT ${clientExpr} AS client, COUNT(op.id)::int AS count
         FROM operacoes op
         ${join}
         ${where ? where + ' AND ' : 'WHERE ' } (${A})
         GROUP BY ${clientExpr}
         ORDER BY count DESC
         LIMIT 10`, params
    )).rows.map(r => ({ client: r.client, count: r.count }));

    res.json({ total, onTime, late, latePct, topOffenders: off, topClients });
  } catch (e) {
    console.error('getKpis error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

/* ======================= Companies (filtro) ======================= */
exports.getCompanies = async (_req, res) => {
  try {
    await ensureEmb();
    const C = await getOpCols();

    // 1) Se há tabela embarcadores com coluna de nome, usa
    if (cache.hasEmb && cache.embNameCol){
      const rows = (await db.query(
        `SELECT id, "${cache.embNameCol}" AS name
           FROM embarcadores
          WHERE "${cache.embNameCol}" IS NOT NULL AND "${cache.embNameCol}" <> ''
          ORDER BY "${cache.embNameCol}" ASC`)).rows;
      if (rows.length) return res.json(rows);
    }

    // 2) Fallback distinct em operacoes
    const c1 = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    if (!c1) return res.json([]);
    const rows = (await db.query(
      `SELECT DISTINCT op."${c1}" AS name
         FROM operacoes op
        WHERE op."${c1}" IS NOT NULL AND op."${c1}" <> ''
        ORDER BY op."${c1}" ASC`)).rows;
    res.json(rows.map((r,i)=>({ id: -1*(i+1), name: r.name })));
  } catch (e) {
    console.error('getCompanies error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

/* ======================= Lista de operações ======================= */
exports.getOperations = async (req, res) => {
  try {
    await ensureEmb();
    const C = await getOpCols();
    const { where, params } = buildWhereAndParams(req.query);

    const c1 = pickCol(C, ['embarcador','nome_embarcador','cliente','cliente_nome']);
    const clientExpr = `COALESCE(${[
      c1 && `op."${c1}"`,
      cache.hasEmb && cache.embNameCol && `NULLIF(e."${cache.embNameCol}",'')`
    ].filter(Boolean).join(', ')})`;

    const p1 = pickCol(C, ['porto','pol','pod','port']);
    const portExpr = p1 ? `op."${p1}"` : `NULL::text`;

    const join = (cache.hasEmb && cache.embNameCol && C.has('embarcador_id'))
      ? `LEFT JOIN embarcadores e ON e.id = op.embarcador_id` : ``;

    const selectList = selectOps(C, clientExpr || 'NULL::text', portExpr);

    const rows = (await db.query(
      `SELECT ${selectList}
         FROM operacoes op
         ${join}
         ${where}
        ORDER BY op.previsao_inicio_atendimento DESC NULLS LAST
        LIMIT 1000`, params
    )).rows;

    res.json({ items: rows });
  } catch (e) {
    console.error('getOperations error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getPendingUsers = async (_req, res) => res.json([]);