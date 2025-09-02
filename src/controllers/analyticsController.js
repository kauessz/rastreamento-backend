const db = require('../database');

// Normaliza atraso (minutos) a partir de colunas diferentes (tempo_atraso numérico e atraso_hhmm texto)
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

/**
 * GET /api/analytics/daily-delays?date=YYYY-MM-DD&companyId=
 * Retorna lista de operações do dia + KPIs do dia ({total, onTime, atrasadas, pct})
 */
exports.getDailyDelays = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;

    const sql = `
      SELECT
        o.id, o.booking,
        COALESCE(o.containers, o.container, o.conteiner) AS containers,
        COALESCE(o.nome_embarcador, o.embarcador) AS nome_embarcador,
        COALESCE(o.porto, o.porto_origem) AS porto,
        o.previsao_inicio_atendimento,
        o.dt_inicio_execucao,
        o.dt_fim_execucao,
        COALESCE(o.motivo_atraso, o.motivo_do_atraso, o.motivo) AS motivo_atraso,
        ${atrasoMinExpr} AS atraso_min,
        CASE WHEN ${atrasoMinExpr} > 0 THEN true ELSE false END AS late_flag,
        -- campos extras para o detalhe da linha:
        COALESCE(o.tipo_operacao, o.tipo, o.operacao_tipo) AS tipo_operacao,
        COALESCE(o.transportadora, o.transportadora_nome, o.carrier) AS transportadora,
        COALESCE(o.numero_programacao, o.programacao, o.num_programacao) AS numero_programacao,
        COALESCE(o.motorista_nome, o.nome_motorista) AS motorista_nome,
        COALESCE(o.motorista_cpf, o.cpf_motorista) AS motorista_cpf,
        COALESCE(o.placa_veiculo, o.veiculo_placa, o.placa_cavalo) AS placa_veiculo,
        COALESCE(o.placa_carreta, o.carreta_placa, o.placa_reboque) AS placa_carreta,
        COALESCE(o.status_operacao, o.status) AS status_operacao
      FROM operacoes o
      WHERE DATE(o.previsao_inicio_atendimento) = $1
        AND ($2::int IS NULL OR o.company_id = $2)
      ORDER BY o.previsao_inicio_atendimento ASC, o.booking ASC
    `;
    const { rows } = await db.query(sql, [date, companyId]);

    const total = rows.length;
    const atrasadas = rows.filter(r => r.late_flag).length;
    const onTime = total - atrasadas;
    const pct = total ? Math.round((atrasadas/total)*10000)/100 : 0;

    res.json({
      date,
      total, onTime, atrasadas, pct,
      items: rows
    });
  } catch (err) {
    console.error('[analytics/daily-delays]', err);
    res.status(500).json({ error: 'Falha ao obter atrasos do dia' });
  }
};

/**
 * GET /api/analytics/daily-reasons?date=YYYY-MM-DD&companyId=
 * Retorna agregação de motivos de atraso no dia (labels/data) + tabela
 */
exports.getDailyReasons = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;

    const sql = `
      SELECT COALESCE(o.motivo_atraso, o.motivo_do_atraso, o.motivo, 'Sem motivo') AS motivo,
             COUNT(*) AS qtd
      FROM operacoes o
      WHERE DATE(o.previsao_inicio_atendimento) = $1
        AND (${atrasoMinExpr} > 0)
        AND ($2::int IS NULL OR o.company_id = $2)
      GROUP BY 1
      ORDER BY qtd DESC
    `;
    const { rows } = await db.query(sql, [date, companyId]);

    const labels = rows.map(r => r.motivo);
    const data = rows.map(r => Number(r.qtd));

    res.json({
      date,
      labels,
      data,
      tabela: rows
    });
  } catch (err) {
    console.error('[analytics/daily-reasons]', err);
    res.status(500).json({ error: 'Falha ao obter motivos do dia' });
  }
};

/**
 * GET /api/analytics/kpis?start=YYYY-MM-DD&end=YYYY-MM-DD&companyId=
 * Retorna KPIs do período e, opcionalmente, dados para os 2 gráficos (top motivos e top clientes)
 */
exports.getKpisRange = async (req, res) => {
  try {
    const start = req.query.start;
    const end   = req.query.end;
    if (!start || !end) return res.status(400).json({ error: 'start e end são obrigatórios (YYYY-MM-DD)' });
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;

    // 1) KPIs agregados
    const kpiSql = `
      WITH base AS (
        SELECT ${atrasoMinExpr} AS atraso_min
        FROM operacoes o
        WHERE DATE(o.previsao_inicio_atendimento) BETWEEN $1 AND $2
          AND ($3::int IS NULL OR o.company_id = $3)
      )
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN atraso_min > 0 THEN 1 ELSE 0 END)::int AS atrasadas,
        SUM(CASE WHEN atraso_min <= 0 THEN 1 ELSE 0 END)::int AS ontime
      FROM base;
    `;
    const kpi = await db.query(kpiSql, [start, end, companyId]);
    const total = kpi.rows[0]?.total || 0;
    const atrasadas = kpi.rows[0]?.atrasadas || 0;
    const ontime = kpi.rows[0]?.ontime || 0;

    // 2) Top 10 motivos no período
    const motivosSql = `
      SELECT COALESCE(o.motivo_atraso, o.motivo_do_atraso, o.motivo, 'Sem motivo') AS motivo,
             COUNT(*)::int AS qtd
      FROM operacoes o
      WHERE DATE(o.previsao_inicio_atendimento) BETWEEN $1 AND $2
        AND (${atrasoMinExpr} > 0)
        AND ($3::int IS NULL OR o.company_id = $3)
      GROUP BY 1
      ORDER BY qtd DESC
      LIMIT 10;
    `;
    const motivos = await db.query(motivosSql, [start, end, companyId]);

    // 3) Top 10 clientes com atraso no período
    const clientesSql = `
      SELECT COALESCE(o.nome_embarcador, o.embarcador, 'Sem cliente') AS cliente,
             COUNT(*)::int AS qtd
      FROM operacoes o
      WHERE DATE(o.previsao_inicio_atendimento) BETWEEN $1 AND $2
        AND (${atrasoMinExpr} > 0)
        AND ($3::int IS NULL OR o.company_id = $3)
      GROUP BY 1
      ORDER BY qtd DESC
      LIMIT 10;
    `;
    const clientes = await db.query(clientesSql, [start, end, companyId]);

    res.json({
      kpis: {
        total_operacoes: total,
        operacoes_on_time: ontime,
        operacoes_atrasadas: atrasadas
      },
      grafico_ofensores: {
        labels: motivos.rows.map(r => r.motivo),
        data: motivos.rows.map(r => r.qtd)
      },
      grafico_clientes_atraso: {
        labels: clientes.rows.map(r => r.cliente),
        data: clientes.rows.map(r => r.qtd)
      }
    });
  } catch (err) {
    console.error('[analytics/kpis]', err);
    res.status(500).json({ error: 'Falha ao obter KPIs do período' });
  }
};