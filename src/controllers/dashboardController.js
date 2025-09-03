// src/controllers/dashboardController.js
const db = require('../config/database');

/** Cache leve p/ saber se existe a tabela embarcadores */
let hasEmbarcadoresCache = null;
async function hasEmbarcadores() {
  if (hasEmbarcadoresCache !== null) return hasEmbarcadoresCache;
  try {
    const q = await db.query(`SELECT to_regclass('public.embarcadores') AS reg`);
    hasEmbarcadoresCache = !!(q.rows[0] && q.rows[0].reg);
  } catch (e) {
    console.error('hasEmbarcadores check error:', e);
    hasEmbarcadoresCache = false;
  }
  return hasEmbarcadoresCache;
}

/** WHERE/params a partir dos filtros do front */
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

/** KPIs + gráficos (formato plano esperado pelo front) */
exports.getKpis = async (req, res) => {
  try {
    const { where, params } = buildWhereAndParams(req.query);
    const embOK = await hasEmbarcadores();
    const clientExpr = embOK ? `COALESCE(emb.nome, op.nome_embarcador)` : `op.nome_embarcador`;
    const joinEmb    = embOK ? `LEFT JOIN embarcadores emb ON emb.id = op.embarcador_id` : ``;

    // Regra de atraso resiliente:
    // 1) tempo_atraso > 0
    // 2) OU "Situação prazo programação" indicando atraso (texto)
    const atrasoCond = `
      (COALESCE(op.tempo_atraso, 0) > 0)
      OR (COALESCE(op.situacao_prazo_programacao, '') ILIKE '%atras%')
    `;

    const totalQ = await db.query(`SELECT COUNT(*) FROM operacoes op ${where}`, params);
    const total = parseInt(totalQ.rows[0].count, 10) || 0;

    const lateQ = await db.query(
      `SELECT COUNT(*) FROM operacoes op ${where ? where + ' AND ' + atrasoCond : 'WHERE ' + atrasoCond}`,
      params
    );
    const late = parseInt(lateQ.rows[0].count, 10) || 0;

    const onTime = Math.max(total - late, 0);
    const latePct = total > 0 ? Number(((late / total) * 100).toFixed(2)) : 0;

    // Principais justificativas/motivos (ambos do CSV)
    const offQ = await db.query(
      `SELECT COALESCE(NULLIF(op.justificativa_atraso, ''), op.motivo_atraso) AS reason,
              COUNT(*)::int AS count
       FROM operacoes op
       ${where ? where + ' AND ' : 'WHERE '} (${atrasoCond})
       GROUP BY COALESCE(NULLIF(op.justificativa_atraso, ''), op.motivo_atraso)
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    // Clientes com mais atrasos
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
      total,
      onTime,
      late,
      latePct,
      topOffenders: offQ.rows.map(r => ({ reason: r.reason || 'Sem justificativa', count: r.count })),
      topClients:   cliQ.rows.map(r => ({ client: r.client || 'Sem cliente', count: r.count })),
    });
  } catch (e) {
    console.error('getKpis error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

/** Embarcadores p/ o filtro (usa tabela se existir; senão DISTINCT do CSV) */
exports.getCompanies = async (_req, res) => {
  try {
    const embOK = await hasEmbarcadores();

    if (embOK) {
      const { rows } = await db.query(`SELECT id, nome AS name FROM embarcadores ORDER BY nome ASC`);
      if (rows.length) return res.json(rows);
    }

    const { rows: opRows } = await db.query(
      `SELECT DISTINCT nome_embarcador AS name
       FROM operacoes
       WHERE nome_embarcador IS NOT NULL AND nome_embarcador <> ''
       ORDER BY nome_embarcador ASC`
    );
    return res.json(opRows.map((r, i) => ({ id: -1 * (i + 1), name: r.name })));
  } catch (e) {
    console.error('getCompanies error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

/** Lista de operações (sem to_char — datas como texto; atraso via tempo_atraso/HH:MM prontos) */
exports.getOperations = async (req, res) => {
  try {
    const { where, params } = buildWhereAndParams(req.query);
    const embOK = await hasEmbarcadores();
    const clientExpr = embOK ? `COALESCE(emb.nome, op.nome_embarcador)` : `op.nome_embarcador`;
    const joinEmb    = embOK ? `LEFT JOIN embarcadores emb ON emb.id = op.embarcador_id` : ``;

    const { rows } = await db.query(
      `SELECT
         op.booking AS booking,
         op.containers AS container,
         ${clientExpr} AS client,
         op.porto AS port,
         op.previsao_inicio_atendimento::text AS sla_previsao,
         op.dt_inicio_execucao::text          AS exec_inicio,
         op.dt_fim_execucao::text             AS exec_fim,
         COALESCE(
           NULLIF(op.atraso_hhmm, ''),
           CASE
             WHEN COALESCE(op.tempo_atraso,0) > 0
               THEN lpad((op.tempo_atraso/60)::text, 2, '0') || ':' || lpad((op.tempo_atraso%60)::text, 2, '0')
             ELSE '00:00'
           END
         ) AS atraso_hhmm,
         COALESCE(NULLIF(op.justificativa_atraso, ''), op.motivo_atraso) AS motivo,
         op.tipo_operacao,
         op.transportadora,
         op.numero_programacao   AS num_programacao,
         op.nome_motorista       AS motorista,
         op.cpf_motorista        AS cpf,
         op.placa_veiculo,
         op.placa_carreta,
         op.numero_cliente
       FROM operacoes op
       ${joinEmb}
       ${where}
       ORDER BY op.previsao_inicio_atendimento DESC NULLS LAST
       LIMIT 1000`,
      params
    );

    res.json({ items: rows });
  } catch (e) {
    console.error('getOperations error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getPendingUsers = async (_req, res) => res.json([]);