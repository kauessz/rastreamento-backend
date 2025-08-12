// =========================================================================================
//                                     operationController.js (Versão Final com Integração IA)
// =========================================================================================

const fs = require('fs');
const csv = require('csv-parser');
const { parse, isValid } = require('date-fns');
const axios = require('axios'); // Importamos o Axios para fazer chamadas de API
const db = require('../config/database');

// -----------------------------------------------------------------------------------------
// FUNÇÃO 1: RASTREAMENTO PÚBLICO (sem alterações)
// -----------------------------------------------------------------------------------------
exports.trackOperationPublic = async (req, res) => {
  try {
    const { tracking_code } = req.params;
    const query = `
      SELECT 
        emb.nome_principal AS nome_embarcador,
        op.status_operacao, op.previsao_inicio_atendimento, op.dt_inicio_execucao,
        op.dt_fim_execucao, op.dt_previsao_entrega_recalculada, op.booking,
        op.containers, op.tipo_programacao, op.nome_motorista, op.placa_veiculo,
        op.placa_carreta, op.cpf_motorista
      FROM operacoes op
      JOIN embarcadores emb ON op.embarcador_id = emb.id
      WHERE op.booking ILIKE $1 OR op.containers ILIKE $2;
    `;
    const queryParams = [tracking_code, `%${tracking_code}%`];
    const { rows } = await db.query(query, queryParams);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Operação não encontrada.' });
    }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erro no rastreamento público:', error);
    res.status(500).json({ message: 'Erro ao buscar operação.' });
  }
};

// -----------------------------------------------------------------------------------------
// FUNÇÃO 2: UPLOAD DA PLANILHA (com a nova lógica de IA)
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
            const parsedDate = parse(dateString, format, new Date());
            if (isValid(parsedDate)) { return parsedDate.toISOString(); }
        }
        console.warn(`Formato de data não reconhecido para o valor: "${dateString}"`);
        return null;
    };

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(csv({ separator: ';', mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '') }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                // ETAPA 1: Consultar a IA para padronizar os nomes
                // Coleta todos os nomes de embarcadores únicos da planilha
                const rawShipperNames = [...new Set(results.map(row => row['Embarcador']).filter(name => name))];
                
                let shipperNameMapping = {};
                if (rawShipperNames.length > 0) {
                    console.log("Consultando serviço de IA para os nomes:", rawShipperNames);
                    const aiResponse = await axios.post('http://localhost:5000/standardize', {
                        names: rawShipperNames
                    });
                    shipperNameMapping = aiResponse.data;
                    console.log("Mapeamento recebido da IA:", shipperNameMapping);
                }

                await client.query('BEGIN');
                for (const row of results) {
                    // ETAPA 2: Usar o nome padronizado retornado pela IA
                    const rawName = row['Embarcador'];
                    if (!rawName) continue; // Pula a linha se não tiver nome de embarcador
                    
                    const standardizedName = shipperNameMapping[rawName] || rawName;
                    
                    let embarcadorId;
                    let embarcadorResult = await client.query('SELECT id FROM embarcadores WHERE nome_principal = $1', [standardizedName]);
                    
                    if (embarcadorResult.rows.length > 0) {
                        embarcadorId = embarcadorResult.rows[0].id;
                    } else {
                        // Se o embarcador mestre não existe, cria um novo
                        const newEmbarcador = await client.query('INSERT INTO embarcadores (nome_principal) VALUES ($1) RETURNING id', [standardizedName]);
                        embarcadorId = newEmbarcador.rows[0].id;
                    }

                    // Se o nome original era diferente do padronizado, garante que ele exista como um alias
                    if (rawName !== standardizedName) {
                        await client.query(
                            'INSERT INTO embarcador_aliases (nome_alias, embarcador_id) VALUES ($1, $2) ON CONFLICT (nome_alias) DO NOTHING',
                            [rawName, embarcadorId]
                        );
                    }
                    
                    const upsertQuery = `
                        INSERT INTO operacoes (numero_programacao, booking, containers, pol, pod, tipo_programacao, previsao_inicio_atendimento, dt_inicio_execucao, dt_fim_execucao, dt_previsao_entrega_recalculada, nome_motorista, placa_veiculo, placa_carreta, cpf_motorista, justificativa_atraso, embarcador_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        ON CONFLICT (numero_programacao) DO UPDATE SET
                        booking = EXCLUDED.booking, containers = EXCLUDED.containers, pol = EXCLUDED.pol, pod = EXCLUDED.pod, tipo_programacao = EXCLUDED.tipo_programacao, previsao_inicio_atendimento = EXcluded.previsao_inicio_atendimento, dt_inicio_execucao = EXCLUDED.dt_inicio_execucao, dt_fim_execucao = EXCLUDED.dt_fim_execucao, dt_previsao_entrega_recalculada = EXCLUDED.dt_previsao_entrega_recalculada, nome_motorista = EXCLUDED.nome_motorista, placa_veiculo = EXCLUDED.placa_veiculo, placa_carreta = EXCLUDED.placa_carreta, cpf_motorista = EXCLUDED.cpf_motorista, justificativa_atraso = EXCLUDED.justificativa_atraso, embarcador_id = EXCLUDED.embarcador_id, data_atualizacao = NOW();
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
                }
                await client.query('COMMIT');
                res.status(200).json({ message: `${results.length} operações processadas e padronizadas com sucesso.` });
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
// FUNÇÃO 3: BUSCA DE OPERAÇÕES PARA O DASHBOARD (sem alterações)
// -----------------------------------------------------------------------------------------
exports.getOperations = async (req, res) => {
  try {
    const { page = 1, limit = 20, embarcador_id, booking, data_previsao, status, sortBy, sortOrder } = req.query;
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let filterParams = [];
    let paramCount = 1;

    if (embarcador_id) { whereClauses.push(`op.embarcador_id = $${paramCount++}`); filterParams.push(embarcador_id); }
    if (booking) { whereClauses.push(`op.booking ILIKE $${paramCount++}`); filterParams.push(`%${booking}%`); }
    if (data_previsao) { whereClauses.push(`op.previsao_inicio_atendimento::date = $${paramCount++}`); filterParams.push(data_previsao); }
    if (status === 'atrasadas') {
        whereClauses.push(`(op.dt_inicio_execucao > op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()))`);
    } else if (status === 'on_time') {
        whereClauses.push(`(op.dt_inicio_execucao <= op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento >= NOW()))`);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const sortableColumns = ['booking', 'containers', 'nome_embarcador', 'porto', 'previsao_inicio_atendimento'];
    const orderByColumn = sortableColumns.includes(sortBy) ? `"${sortBy}"` : 'previsao_inicio_atendimento';
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countQuery = `SELECT COUNT(*) FROM operacoes op ${whereString}`;
    const countResult = await db.query(countQuery, filterParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT 
        op.*,
        emb.nome_principal AS nome_embarcador,
        CASE WHEN op.tipo_programacao ILIKE '%entrega%' THEN op.pod ELSE op.pol END AS porto,
        CASE
          WHEN op.dt_inicio_execucao > op.previsao_inicio_atendimento THEN
            TRUNC(EXTRACT(EPOCH FROM (op.dt_inicio_execucao - op.previsao_inicio_atendimento)) / 3600) || 'h ' ||
            TO_CHAR((op.dt_inicio_execucao - op.previsao_inicio_atendimento), 'MI"m"')
          WHEN op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW() THEN
            TRUNC(EXTRACT(EPOCH FROM (NOW() - op.previsao_inicio_atendimento)) / 3600) || 'h ' ||
            TO_CHAR((NOW() - op.previsao_inicio_atendimento), 'MI"m"')
          ELSE 'ON TIME'
        END AS atraso
      FROM operacoes op JOIN embarcadores emb ON op.embarcador_id = emb.id
      ${whereString} ORDER BY ${orderByColumn} ${orderDirection}, op.id DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++};
    `;
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
// FUNÇÃO 4: DELETAR TODAS AS OPERAÇÕES (sem alterações)
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