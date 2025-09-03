const db = require('../config/database');

// Converte filtros do front p/ WHERE/params
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

// KPIs + dados dos gráficos (formato que o front espera)
exports.getKpis = async (req, res) => {
  try {
    const { where, params } = buildWhereAndParams(req.query);

    // “Atraso” prioriza tempo_atraso; senão compara início vs previsão
    const atrasoCond = `
      (op.tempo_atraso IS NOT NULL AND op.tempo_atraso > 0)
      OR (
        (op.tempo_atraso IS NULL OR op.tempo_atraso = 0)
        AND (
          (op.dt_inicio_execucao IS NOT NULL AND op.previsao_inicio_atendimento IS NOT NULL
            AND op.dt_inicio_execucao > op.previsao_inicio_atendimento)
          OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento IS NOT NULL
            AND op.previsao_inicio_atendimento < NOW())
        )
      )
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

    // Top ofensores por justificativa/motivo
    const offQ = await db.query(
      `SELECT COALESCE(NULLIF(op.justificativa_atraso, ''), op.motivo_atraso) AS reason,
              COUNT(*)::int AS count
       FROM operacoes op
       ${where ? where + ' AND ' : 'WHERE '}
       ${atrasoCond}
       GROUP BY COALESCE(NULLIF(op.justificativa_atraso, ''), op.motivo_atraso)
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    // Top clientes com atraso (usa COALESCE do FK com texto livre)
    const cliQ = await db.query(
      `SELECT COALESCE(emb.nome, op.nome_embarcador) AS client,
              COUNT(op.id)::int AS count
       FROM operacoes op
       LEFT JOIN embarcadores emb ON emb.id = op.embarcador_id
       ${where ? where + ' AND ' : 'WHERE '}
       ${atrasoCond}
       GROUP BY COALESCE(emb.nome, op.nome_embarcador)
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
      topClients:   cliQ.rows.map(r => ({ client: r.client || 'Sem cliente',    count: r.count })),
    });
  } catch (e) {
    console.error('getKpis error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// Lista embarcadores para o filtro
exports.getCompanies = async (_req, res) => {
  try {
    const { rows: emb } = await db.query(
      `SELECT id, nome AS name FROM embarcadores ORDER BY nome ASC`
    );
    if (emb.length) return res.json(emb);

    const { rows: distinctOps } = await db.query(
      `SELECT DISTINCT nome_embarcador AS name
         FROM operacoes
        WHERE nome_embarcador IS NOT NULL AND nome_embarcador <> ''
        ORDER BY nome_embarcador ASC`
    );
    return res.json(distinctOps.map((r, i) => ({ id: -1*(i+1), name: r.name })));
  } catch (e) {
    console.error('getCompanies error:', e);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// Lista de operações (campos que o front rende)
exports.getOperations = async (req, res) => {
  try {
    const { where, params } = buildWhereAndParams(req.query);

    const { rows } = await db.query(
      `SELECT
         op.booking AS booking,
         op.containers AS container,
         COALESCE(emb.nome, op.nome_embarcador) AS client,
         op.porto AS port,
         to_char(op.previsao_inicio_atendimento, 'YYYY-MM-DD HH24:MI') AS sla_previsao,
         to_char(op.dt_inicio_execucao,        'YYYY-MM-DD HH24:MI') AS exec_inicio,
         to_char(op.dt_fim_execucao,           'YYYY-MM-DD HH24:MI') AS exec_fim,
         COALESCE(
           NULLIF(op.atraso_hhmm, ''),
           CASE
             WHEN op.tempo_atraso IS NOT NULL AND op.tempo_atraso > 0
               THEN lpad((op.tempo_atraso/60)::text, 2, '0') || ':' || lpad((op.tempo_atraso%60)::text, 2, '0')
             WHEN op.dt_inicio_execucao IS NOT NULL AND op.previsao_inicio_atendimento IS NOT NULL
                  AND op.dt_inicio_execucao > op.previsao_inicio_atendimento
               THEN to_char((op.dt_inicio_execucao - op.previsao_inicio_atendimento), 'HH24:MI')
             WHEN op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento IS NOT NULL
                  AND op.previsao_inicio_atendimento < NOW()
               THEN to_char((NOW() - op.previsao_inicio_atendimento), 'HH24:MI')
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
       LEFT JOIN embarcadores emb ON emb.id = op.embarcador_id
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

// Placeholder
exports.getPendingUsers = async (_req, res) => res.json([]);