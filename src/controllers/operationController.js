// =========================================================================================
//                                     operationController.js (Versão Final com Auto-Cadastro)
// =========================================================================================

const fs = require('fs');
const csv = require('csv-parser');
const { parse, isValid } = require('date-fns');
const db = require('../config/database');

// -----------------------------------------------------------------------------------------
// FUNÇÃO DE PADRONIZAÇÃO DE NOMES ("GERENTE INTERNO")
// Esta função contém as regras de negócio para unificar os nomes dos embarcadores.
// -----------------------------------------------------------------------------------------
async function getStandardizedShipperId(rawName) {
    if (!rawName || !rawName.trim()) return null;

    // Regras de mapeamento: se o nome "sujo" contém uma palavra-chave, ele corresponde ao mestre.
    // Esta lista é sua "base de conhecimento" inicial.
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
        // Adicione outras regras de mapeamento aqui...
    };

    const upperRawName = rawName.toUpperCase().trim();
    let masterName = null;

    // 1. Tenta encontrar uma correspondência nas regras predefinidas.
    for (const master in mappingRules) {
        for (const keyword of mappingRules[master]) {
            if (upperRawName.includes(keyword)) {
                masterName = master;
                break;
            }
        }
        if (masterName) break;
    }

    // 2. Se nenhuma regra funcionou, usa o nome original "limpo" como um potencial novo mestre.
    if (!masterName) {
        masterName = rawName.trim();
    }
    
    // 3. Busca no banco se este 'masterName' já existe.
    let result = await db.query('SELECT id FROM embarcadores WHERE nome_principal = $1', [masterName]);
    let masterId;

    if (result.rows.length > 0) {
        // Se já existe, pega o ID.
        masterId = result.rows[0].id;
    } else {
        // 4. Se não existe, CRIA um novo embarcador mestre. O sistema aprende sozinho.
        console.log(`Criando novo embarcador mestre: "${masterName}"`);
        const newMaster = await db.query('INSERT INTO embarcadores (nome_principal) VALUES ($1) RETURNING id', [masterName]);
        masterId = newMaster.rows[0].id;
    }

    // 5. Garante que o nome original "sujo" se torne um apelido para o mestre correto.
    if (rawName.trim() !== masterName) {
        await db.query('INSERT INTO embarcador_aliases (nome_alias, embarcador_id) VALUES ($1, $2) ON CONFLICT (nome_alias) DO NOTHING', [rawName.trim(), masterId]);
    }
    
    return masterId;
}


// -----------------------------------------------------------------------------------------
// FUNÇÃO 1: UPLOAD DA PLANILHA (usando a nova lógica)
// -----------------------------------------------------------------------------------------
exports.uploadOperations = async (req, res) => {
    if (!req.file) { return res.status(400).json({ message: 'Nenhum arquivo enviado.' }); }
    const results = [];
    const filePath = req.file.path;
    const client = await db.pool.connect();

    const parseDate = (dateString) => {
        if (!dateString || dateString.trim() === '') return null;
        const formats = ['dd/MM/yyyy HH:mm', 'dd/MM/yyyy HH:mm:ss'];
        for (const format of formats) {
            const parsedDate = parse(dateString.trim(), format, new Date());
            if (isValid(parsedDate)) { return parsedDate.toISOString(); }
        }
        console.warn(`Formato de data não reconhecido: "${dateString}"`);
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

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(csv({ separator: ';', headers: csvHeaders, skipLines: 1 }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            let processedCount = 0;
            let skippedCount = 0;
            try {
                await client.query('BEGIN');
                for (const row of results) {
                    const embarcadorId = await getStandardizedShipperId(row['Embarcador']);
                    if (!embarcadorId) {
                        skippedCount++;
                        continue;
                    }
                    
                    const upsertQuery = `
                        INSERT INTO operacoes (numero_programacao, booking, containers, pol, pod, tipo_programacao, previsao_inicio_atendimento, dt_inicio_execucao, dt_fim_execucao, dt_previsao_entrega_recalculada, nome_motorista, placa_veiculo, placa_carreta, cpf_motorista, justificativa_atraso, embarcador_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        ON CONFLICT (numero_programacao) DO UPDATE SET
                        booking = EXCLUDED.booking, containers = EXCLUDED.containers, pol = EXCLUDED.pol, pod = EXCLUDED.pod, tipo_programacao = EXCLUDED.tipo_programacao, previsao_inicio_atendimento = EXCLUDED.previsao_inicio_atendimento, dt_inicio_execucao = EXCLUDED.dt_inicio_execucao, dt_fim_execucao = EXCLUDED.dt_fim_execucao, dt_previsao_entrega_recalculada = EXCLUDED.dt_previsao_entrega_recalculada, nome_motorista = EXCLUDED.nome_motorista, placa_veiculo = EXCLUDED.placa_veiculo, placa_carreta = EXCLUDED.placa_carreta, cpf_motorista = EXCLUDED.cpf_motorista, justificativa_atraso = EXCLUDED.justificativa_atraso, embarcador_id = EXCLUDED.embarcador_id, data_atualizacao = NOW();
                    `;
                    
                    const values = [
                        row['Número da programação'], row['Booking'], row['Containers'], row['POL'], row['POD'], 
                        row['Tipo de programação'], parseDate(row['Previsão início atendimento (BRA)']), 
                        parseDate(row['Dt Início da Execução (BRA)']), parseDate(row['Dt FIM da Execução (BRA)']), 
                        parseDate(row['Data de previsão de entrega recalculada (BRA)']), 
                        row['Nome do motorista programado'], row['Placa do veículo'], row['Placa da carreta 1'], 
                        row['CPF motorista programado'], row['Justificativa de atraso de programação'], embarcadorId
                    ];
                    await client.query(upsertQuery, values);
                    processedCount++;
                }
                await client.query('COMMIT');
                res.status(200).json({ message: `${processedCount} operações processadas. ${skippedCount} linhas puladas por embarcador inválido.` });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Erro ao processar o arquivo CSV:', error);
                res.status(500).json({ message: 'Erro ao processar o arquivo.' });
            } finally {
                client.release();
                fs.unlinkSync(filePath);
            }
        });
};

// -----------------------------------------------------------------------------------------
// FUNÇÃO 2: BUSCA DE OPERAÇÕES PARA O DASHBOARD
// -----------------------------------------------------------------------------------------
exports.getOperations = async (req, res) => {
  try {
    const { page = 1, limit = 20, embarcador_id, booking, data_previsao, status, sortBy, sortOrder } = req.query;
    const offset = (page - 1) * limit;
    let whereClauses = []; let filterParams = []; let paramCount = 1;
    if (embarcador_id) { whereClauses.push(`op.embarcador_id = $${paramCount++}`); filterParams.push(embarcador_id); }
    if (booking) { whereClauses.push(`op.booking ILIKE $${paramCount++}`); filterParams.push(`%${booking}%`); }
    if (data_previsao) { whereClauses.push(`op.previsao_inicio_atendimento::date = $${paramCount++}`); filterParams.push(data_previsao); }
    if (status === 'atrasadas') { whereClauses.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()))`); } 
    else if (status === 'on_time') { whereClauses.push(`(op.dt_inicio_execucao <= op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento >= NOW()))`); }
    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sortableColumns = ['booking', 'containers', 'nome_embarcador', 'porto', 'previsao_inicio_atendimento'];
    const orderByColumn = sortableColumns.includes(sortBy) ? `"${sortBy}"` : 'previsao_inicio_atendimento';
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const countQuery = `SELECT COUNT(*) FROM operacoes op ${whereString}`;
    const countResult = await db.query(countQuery, filterParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const dataQuery = `
      SELECT op.*, emb.nome_principal AS nome_embarcador,
      CASE WHEN op.tipo_programacao ILIKE '%entrega%' THEN op.pod ELSE op.pol END AS porto,
      CASE
        WHEN op.dt_inicio_execucao > op.previsao_inicio_atendimento THEN TRUNC(EXTRACT(EPOCH FROM (op.dt_inicio_execucao - op.previsao_inicio_atendimento)) / 3600) || 'h ' || TO_CHAR((op.dt_inicio_execucao - op.previsao_inicio_atendimento), 'MI"m"')
        WHEN op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW() THEN TRUNC(EXTRACT(EPOCH FROM (NOW() - op.previsao_inicio_atendimento)) / 3600) || 'h ' || TO_CHAR((NOW() - op.previsao_inicio_atendimento), 'MI"m"')
        ELSE 'ON TIME'
      END AS atraso
      FROM operacoes op JOIN embarcadores emb ON op.embarcador_id = emb.id
      ${whereString} ORDER BY ${orderByColumn} ${orderDirection}, op.id DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++};`;
    const queryParams = [...filterParams, limit, offset];
    const dataResult = await db.query(dataQuery, queryParams);
    const totalPages = Math.ceil(totalItems / limit);
    res.status(200).json({
      data: dataResult.rows,
      pagination: { totalItems, totalPages, currentPage: parseInt(page, 10), limit: parseInt(limit, 10) }
    });
  } catch (error) {
    console.error('Erro ao buscar operações:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// -----------------------------------------------------------------------------------------
// FUNÇÃO 3: RASTREAMENTO PÚBLICO
// -----------------------------------------------------------------------------------------
exports.trackOperationPublic = async (req, res) => {
  try {
    const { tracking_code } = req.params;
    const query = `
      SELECT emb.nome_principal AS nome_embarcador, op.status_operacao, op.previsao_inicio_atendimento, op.dt_inicio_execucao,
        op.dt_fim_execucao, op.dt_previsao_entrega_recalculada, op.booking, op.containers, op.tipo_programacao, 
        op.nome_motorista, op.placa_veiculo, op.placa_carreta, op.cpf_motorista
      FROM operacoes op JOIN embarcadores emb ON op.embarcador_id = emb.id
      WHERE op.booking ILIKE $1 OR op.containers ILIKE $2;`;
    const queryParams = [tracking_code, `%${tracking_code}%`];
    const { rows } = await db.query(query, queryParams);
    if (rows.length === 0) { return res.status(404).json({ message: 'Operação não encontrada.' }); }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erro no rastreamento público:', error);
    res.status(500).json({ message: 'Erro ao buscar operação.' });
  }
};

// -----------------------------------------------------------------------------------------
// FUNÇÃO 4: DELETAR TODAS AS OPERAÇÕES
// -----------------------------------------------------------------------------------------
exports.deleteAllOperations = async (req, res) => {
  try {
    await db.query('TRUNCATE TABLE operacoes RESTART IDENTITY CASCADE;');
    res.status(200).json({ message: 'Todas as operações foram excluídas com sucesso.' });
  } catch (error) {
    console.error('Erro ao excluir todas as operações:', error);
    res.status(500).json({ message: 'Erro interno do servidor ao tentar excluir operações.' });
  }
};