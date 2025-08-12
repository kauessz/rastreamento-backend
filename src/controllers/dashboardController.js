// src/controllers/dashboardController.js
const db = require('../config/database');

exports.getKpis = async (req, res) => {
    try {
        const { embarcador_id, booking, data_previsao } = req.query;

        let whereClauses = [];
        let filterParams = [];
        let paramCount = 1;

        if (embarcador_id) { whereClauses.push(`op.embarcador_id = $${paramCount++}`); filterParams.push(embarcador_id); }
        if (booking) { whereClauses.push(`op.booking ILIKE $${paramCount++}`); filterParams.push(`%${booking}%`); }
        if (data_previsao) { whereClauses.push(`op.previsao_inicio_atendimento::date = $${paramCount++}`); filterParams.push(data_previsao); }
        
        const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const atrasoCondition = `(op.dt_inicio_execucao > op.previsao_inicio_atendimento OR (op.dt_inicio_execucao IS NULL AND op.previsao_inicio_atendimento < NOW()))`;
        
        // Função auxiliar para adicionar 'WHERE' ou 'AND' corretamente
        const addCondition = (baseWhere, newCondition) => {
            return baseWhere.length > 0 ? `${baseWhere} AND ${newCondition}` : `WHERE ${newCondition}`;
        };
        
        const totalOpsQuery = await db.query(`SELECT COUNT(*) FROM operacoes op ${whereString}`, filterParams);
        const total_operacoes = parseInt(totalOpsQuery.rows[0].count, 10);
        
        const atrasadasQuery = await db.query(`SELECT COUNT(*) FROM operacoes op ${addCondition(whereString, atrasoCondition)}`, filterParams);
        const operacoes_atrasadas = parseInt(atrasadasQuery.rows[0].count, 10);

        const onTime = total_operacoes - operacoes_atrasadas;
        const percentual_atraso = total_operacoes > 0 ? (operacoes_atrasadas / total_operacoes) * 100 : 0;
        
        const ofensoresWhere = addCondition(whereString, `op.justificativa_atraso IS NOT NULL AND op.justificativa_atraso != ''`);
        const ofensoresQuery = await db.query(`SELECT op.justificativa_atraso AS ofensor, COUNT(*) as contagem FROM operacoes op ${ofensoresWhere} GROUP BY op.justificativa_atraso ORDER BY contagem DESC LIMIT 10`, filterParams);
        
        const clientesAtrasoWhere = addCondition(whereString, atrasoCondition);
        const clientesAtrasoQuery = await db.query(`SELECT emb.nome_principal AS cliente, COUNT(op.id) as contagem FROM operacoes op JOIN embarcadores emb ON op.embarcador_id = emb.id ${clientesAtrasoWhere} GROUP BY emb.nome_principal ORDER BY contagem DESC LIMIT 10`, filterParams);

        res.status(200).json({
            kpis: { total_operacoes, operacoes_on_time: onTime, operacoes_atrasadas, percentual_atraso: percentual_atraso.toFixed(2) },
            grafico_ofensores: { labels: ofensoresQuery.rows.map(row => row.ofensor), data: ofensoresQuery.rows.map(row => row.contagem) },
            grafico_clientes_atraso: { labels: clientesAtrasoQuery.rows.map(row => row.cliente), data: clientesAtrasoQuery.rows.map(row => row.contagem) }
        });
    } catch (error) {
        console.error('Erro ao buscar KPIs:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
};