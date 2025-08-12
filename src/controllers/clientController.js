// Em: src/controllers/clientController.js (substitua tudo)

const db = require('../config/database');

// Função para buscar o perfil do usuário e garantir que ele é um embarcador ativo
async function getActiveShipperProfile(firebase_uid) {
    const userProfile = await db.query(
        'SELECT embarcador_id FROM usuarios WHERE firebase_uid = $1 AND status = \'ativo\' AND role = \'embarcador\'', 
        [firebase_uid]
    );
    if (userProfile.rows.length === 0 || !userProfile.rows[0].embarcador_id) {
        return null;
    }
    return userProfile.rows[0].embarcador_id;
}

// Função para buscar as operações do cliente
exports.getMyOperations = async (req, res) => {
    try {
        const firebase_uid = req.user.uid;

        const userProfile = await db.query('SELECT embarcador_id FROM usuarios WHERE firebase_uid = $1 AND status = \'ativo\' AND role = \'embarcador\'', [firebase_uid]);

        if (userProfile.rows.length === 0 || !userProfile.rows[0].embarcador_id) {
            return res.status(403).json({ message: 'Acesso negado ou perfil de embarcador não encontrado.' });
        }
        const embarcadorId = userProfile.rows[0].embarcador_id;
        
        const { page = 1, limit = 20, booking, data_previsao } = req.query;
        const offset = (page - 1) * limit;

        let whereClauses = ['op.embarcador_id = $1'];
        let filterParams = [embarcadorId];
        let paramCount = 2;

        if (booking) { whereClauses.push(`op.booking ILIKE $${paramCount++}`); filterParams.push(`%${booking}%`); }
        if (data_previsao) { whereClauses.push(`op.previsao_inicio_atendimento::date = $${paramCount++}`); filterParams.push(data_previsao); }
        
        const whereString = `WHERE ${whereClauses.join(' AND ')}`;

        const countQuery = `SELECT COUNT(*) FROM operacoes op ${whereString}`;
        const countResult = await db.query(countQuery, filterParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);

        // ===== MUDANÇA AQUI: Selecionando mais colunas para os detalhes =====
        const dataQuery = `
            SELECT 
                id, booking, containers, status_operacao, previsao_inicio_atendimento, 
                dt_inicio_execucao, dt_fim_execucao, numero_programacao, tipo_programacao,
                nome_motorista, placa_veiculo, placa_carreta
            FROM operacoes op ${whereString} 
            ORDER BY previsao_inicio_atendimento DESC
            LIMIT $${paramCount++} OFFSET $${paramCount++}
        `;
        const queryParams = [...filterParams, limit, offset];
        const dataResult = await db.query(dataQuery, queryParams);
        
        const totalPages = Math.ceil(totalItems / limit);

        res.status(200).json({
            data: dataResult.rows,
            pagination: { totalItems, totalPages, currentPage: parseInt(page, 10), limit: parseInt(limit, 10) }
        });

    } catch (error) {
        console.error("Erro ao buscar operações do cliente:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
};

// Nova função para buscar os KPIs do cliente
exports.getMyKpis = async (req, res) => {
    try {
        const embarcadorId = await getActiveShipperProfile(req.user.uid);
        if (!embarcadorId) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }

        const whereClause = 'WHERE embarcador_id = $1';
        const atrasoCondition = `(dt_inicio_execucao > previsao_inicio_atendimento OR (dt_inicio_execucao IS NULL AND previsao_inicio_atendimento < NOW()))`;

        const totalOpsQuery = await db.query(`SELECT COUNT(*) FROM operacoes ${whereClause}`, [embarcadorId]);
        const total_operacoes = parseInt(totalOpsQuery.rows[0].count, 10);

        const atrasadasQuery = await db.query(`SELECT COUNT(*) FROM operacoes ${whereClause} AND ${atrasoCondition}`, [embarcadorId]);
        const operacoes_atrasadas = parseInt(atrasadasQuery.rows[0].count, 10);

        const onTime = total_operacoes - operacoes_atrasadas;
        const percentual_atraso = total_operacoes > 0 ? (operacoes_atrasadas / total_operacoes) * 100 : 0;

        res.status(200).json({
            total_operacoes,
            operacoes_on_time: onTime,
            operacoes_atrasadas,
            percentual_atraso: percentual_atraso.toFixed(2)
        });
    } catch (error) {
        console.error('Erro ao buscar KPIs do cliente:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};