// =========================================================================================
//                                    operationController.js (Atualizado)
// =========================================================================================

const fs = require('fs');
const csv = require('csv-parser');
const { parse, isValid } = require('date-fns');
const db = require('../config/database');

// Dependências para decodificar CSV vindo do Excel/Windows
// iconv-lite é OBRIGATÓRIA. chardet é OPCIONAL (auto-detecção). Se não estiver instalada,
// cairemos para latin1 por padrão (mais comum no BR) — ajuste abaixo se quiser forçar UTF-8.
const iconv = require('iconv-lite');
let chardet = null;
try { chardet = require('chardet'); } catch (_) { /* opcional */ }

// -----------------------------------------------------------------------------------------
// FUNÇÃO DE PADRONIZAÇÃO DE NOMES (auto-cadastro de "mestre" e alias)
// -----------------------------------------------------------------------------------------
async function getStandardizedShipperId(rawName) {
  if (!rawName || !rawName.trim()) return null;

  const mappingRules = {
    'AMBEV': ['AMBEV'],
    'BRASKEM': ['BRASKEM'],
    'PROCTER & GAMBLE': ['PROCTER', 'P&G', 'GRAMBLE'],
    'UNILEVER': ['UNILEVER'],
    'CECIL LAMINAÇÃO DE METAIS': ['CECIL'],
    'OWENS-ILLINOIS': ['OWENS-ILLINOIS', 'OWENS ILLINOIS'],
    'ELECTROLUX': ['ELECTROLUX'],
    'SEARA ALIMENTOS': ['SEARA'],
    'BALL': ['BALL'],
    'VIDEOLAR': ['VIDEOLAR'],
    'SAMSUNG': ['SAMSUNG'],
  };

  const upperRawName = rawName.toUpperCase().trim();
  let masterName = null;

  for (const master in mappingRules) {
    for (const keyword of mappingRules[master]) {
      if (upperRawName.includes(keyword)) { masterName = master; break; }
    }
    if (masterName) break;
  }

  if (!masterName) masterName = rawName.trim();

  const existing = await db.query('SELECT id FROM embarcadores WHERE nome_principal = $1', [masterName]);
  let masterId;
  if (existing.rows.length) {
    masterId = existing.rows[0].id;
  } else {
    const created = await db.query('INSERT INTO embarcadores (nome_principal) VALUES ($1) RETURNING id', [masterName]);
    masterId = created.rows[0].id;
  }

  if (rawName.trim() !== masterName) {
    await db.query(
      'INSERT INTO embarcador_aliases (nome_alias, embarcador_id) VALUES ($1, $2) ON CONFLICT (nome_alias) DO NOTHING',
      [rawName.trim(), masterId]
    );
  }

  return masterId;
}

// -----------------------------------------------------------------------------------------
// 1) Upload da planilha (CSV) — com decodificação correta e respostas sempre em JSON
// -----------------------------------------------------------------------------------------
exports.uploadOperations = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });

  const filePath = req.file.path;
  const results = [];
  const client = await db.pool.connect();

  // Detecta encoding quando possível; se chardet não existir, assume latin1 (Windows-1252)
  let detected = 'UTF-8';
  if (chardet) { try { detected = chardet.detectFileSync(filePath) || 'UTF-8'; } catch (_) {} }
  const isLatin = /1252|ISO-8859-1|latin-1|latin1/i.test(detected);

  const parseDate = (dateString) => {
    if (!dateString || String(dateString).trim() === '') return null;
    const formats = ['dd/MM/yyyy HH:mm', 'dd/MM/yyyy HH:mm:ss'];
    for (const fmt of formats) {
      const dt = parse(String(dateString).trim(), fmt, new Date());
      if (isValid(dt)) return dt.toISOString();
    }
    return null;
  };

  const csvHeaders = [
    'Aut. embarque', 'Tipo de programação', 'Situação prazo programação', 'Transportadora',
    'Número da programação', 'Booking', 'Containers', 'Número cliente', 'Tipo container',
    'Previsão início atendimento (BRA)', 'Dt Início da Execução (BRA)', 'Dt FIM da Execução (BRA)',
    'Data de previsão de entrega recalculada (BRA)', 'Tempo no cliente', 'Cidade local de atendimento',
    'Embarcador', 'Nome do motorista programado', 'Placa da carreta 1', 'Placa do veículo',
    'CPF motorista programado', 'Justificativa de atraso de programação', 'Nome local de atendimento',
    'Situação programação', 'POL', 'POD', 'Tipo de ocorrência'
  ];

  try {
    fs.createReadStream(filePath)
      .pipe(iconv.decodeStream(isLatin ? 'latin1' : 'utf8'))
      .pipe(csv({ separator: ';', headers: csvHeaders, skipLines: 1 }))
      .on('data', (row) => results.push(row))
      .on('end', async () => {
        let processed = 0, skipped = 0;
        try {
          await client.query('BEGIN');

          for (const row of results) {
            const embarcadorId = await getStandardizedShipperId(row['Embarcador']);
            if (!embarcadorId) { skipped++; continue; }

            const upsert = `
              INSERT INTO operacoes (
                numero_programacao, booking, containers, pol, pod, tipo_programacao,
                previsao_inicio_atendimento, dt_inicio_execucao, dt_fim_execucao,
                dt_previsao_entrega_recalculada, nome_motorista, placa_veiculo, placa_carreta,
                cpf_motorista, justificativa_atraso, embarcador_id
              ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
              ) ON CONFLICT (numero_programacao) DO UPDATE SET
                booking = EXCLUDED.booking,
                containers = EXCLUDED.containers,
                pol = EXCLUDED.pol,
                pod = EXCLUDED.pod,
                tipo_programacao = EXCLUDED.tipo_programacao,
                previsao_inicio_atendimento = EXCLUDED.previsao_inicio_atendimento,
                dt_inicio_execucao = EXCLUDED.dt_inicio_execucao,
                dt_fim_execucao = EXCLUDED.dt_fim_execucao,
                dt_previsao_entrega_recalculada = EXCLUDED.dt_previsao_entrega_recalculada,
                nome_motorista = EXCLUDED.nome_motorista,
                placa_veiculo = EXCLUDED.placa_veiculo,
                placa_carreta = EXCLUDED.placa_carreta,
                cpf_motorista = EXCLUDED.cpf_motorista,
                justificativa_atraso = EXCLUDED.justificativa_atraso,
                embarcador_id = EXCLUDED.embarcador_id,
                data_atualizacao = NOW();
            `;

            const values = [
              row['Número da programação'], row['Booking'], row['Containers'], row['POL'], row['POD'],
              row['Tipo de programação'],
              parseDate(row['Previsão início atendimento (BRA)']),
              parseDate(row['Dt Início da Execução (BRA)']),
              parseDate(row['Dt FIM da Execução (BRA)']),
              parseDate(row['Data de previsão de entrega recalculada (BRA)']),
              row['Nome do motorista programado'], row['Placa do veículo'], row['Placa da carreta 1'],
              row['CPF motorista programado'], row['Justificativa de atraso de programação'], embarcadorId
            ];

            await client.query(upsert, values);
            processed++;
          }

          await client.query('COMMIT');
          return res.status(200).json({ message: `${processed} operações processadas. ${skipped} linhas puladas por embarcador inválido.` });
        } catch (err) {
          await client.query('ROLLBACK');
          console.error('Erro ao processar o arquivo CSV:', err);
          return res.status(500).json({ message: 'Erro ao processar o arquivo.' });
        } finally {
          client.release();
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      })
      .on('error', (streamErr) => {
        console.error('Erro ao ler CSV:', streamErr);
        try { client.release(); } catch (_) {}
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(500).json({ message: 'Erro ao ler o arquivo CSV.' });
      });
  } catch (outerErr) {
    console.error('Falha no uploadOperations:', outerErr);
    try { client.release(); } catch (_) {}
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(500).json({ message: 'Erro interno no upload.' });
  }
};

// -----------------------------------------------------------------------------------------
// 2) Lista/paginação para o dashboard
// -----------------------------------------------------------------------------------------
exports.getOperations = async (req, res) => {
  try {
    const { page = 1, limit = 20, embarcador_id, booking, data_previsao, status, sortBy, sortOrder } = req.query;
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 20;
    const offset = (p - 1) * l;

    const where = []; const params = []; let n = 1;
    if (embarcador_id) { where.push(`op.embarcador_id = $${n++}`); params.push(embarcador_id); }
    if (booking) { where.push(`op.booking ILIKE $${n++}`); params.push(`%${booking}%`); }
    if (data_previsao) { where.push(`op.previsao_inicio_atendimento::date = $${n++}`); params.push(data_previsao); }
    if (status === 'atrasadas') {
      where.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()))`);
    } else if (status === 'on_time') {
      where.push(`(op.dt_inicio_execucao <= op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento >= NOW()))`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortable = ['booking', 'containers', 'nome_embarcador', 'porto', 'previsao_inicio_atendimento'];
    const orderCol = sortable.includes(sortBy) ? `"${sortBy}"` : 'previsao_inicio_atendimento';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const count = await db.query(`SELECT COUNT(*) FROM operacoes op ${whereSql}`, params);
    const totalItems = parseInt(count.rows[0].count, 10);

    const data = await db.query(`
      SELECT op.*, emb.nome_principal AS nome_embarcador,
        CASE WHEN op.tipo_programacao ILIKE '%entrega%'
             THEN op.pod ELSE op.pol END AS porto,
        CASE
          WHEN op.dt_inicio_execucao > op.previsao_inicio_atendimento THEN
            TRUNC(EXTRACT(EPOCH FROM (op.dt_inicio_execucao - op.previsao_inicio_atendimento)) / 3600) || 'h ' ||
            TO_CHAR((op.dt_inicio_execucao - op.previsao_inicio_atendimento), 'MI"m"')
          WHEN op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW() THEN
            TRUNC(EXTRACT(EPOCH FROM (NOW() - op.previsao_inicio_atendimento)) / 3600) || 'h ' ||
            TO_CHAR((NOW() - op.previsao_inicio_atendimento), 'MI"m"')
          ELSE 'ON TIME'
        END AS atraso
      FROM operacoes op
      JOIN embarcadores emb ON op.embarcador_id = emb.id
      ${whereSql}
      ORDER BY ${orderCol} ${orderDir}, op.id DESC
      LIMIT $${n++} OFFSET $${n++}
    `, [...params, l, offset]);

    return res.status(200).json({
      data: data.rows,
      pagination: { totalItems, totalPages: Math.ceil(totalItems / l), currentPage: p, limit: l }
    });
  } catch (err) {
    console.error('Erro ao buscar operações:', err);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// -----------------------------------------------------------------------------------------
// 3) Rastreio público por booking/containers
// -----------------------------------------------------------------------------------------
exports.trackOperationPublic = async (req, res) => {
  try {
    const { tracking_code } = req.params;
    const sql = `
      SELECT emb.nome_principal AS nome_embarcador, op.status_operacao, op.previsao_inicio_atendimento,
             op.dt_inicio_execucao, op.dt_fim_execucao, op.dt_previsao_entrega_recalculada,
             op.booking, op.containers, op.tipo_programacao, op.nome_motorista, op.placa_veiculo,
             op.placa_carreta, op.cpf_motorista
      FROM operacoes op
      JOIN embarcadores emb ON op.embarcador_id = emb.id
      WHERE op.booking ILIKE $1 OR op.containers ILIKE $2;`;
    const params = [tracking_code, `%${tracking_code}%`];
    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: 'Operação não encontrada.' });
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Erro no rastreamento público:', err);
    return res.status(500).json({ message: 'Erro ao buscar operação.' });
  }
};

// -----------------------------------------------------------------------------------------
// 4) Remover todas as operações
// -----------------------------------------------------------------------------------------
exports.deleteAllOperations = async (_req, res) => {
  try {
    await db.query('TRUNCATE TABLE operacoes RESTART IDENTITY CASCADE;');
    return res.status(200).json({ message: 'Todas as operações foram excluídas com sucesso.' });
  } catch (err) {
    console.error('Erro ao excluir todas as operações:', err);
    return res.status(500).json({ message: 'Erro interno do servidor ao tentar excluir operações.' });
  }
};
