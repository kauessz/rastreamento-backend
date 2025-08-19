// src/controllers/aiController.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require('../config/database'); // Supondo que você possa acessar o DB diretamente

// Inicialize com sua API Key do Google AI Studio
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.analyzeOperations = async (req, res) => {
    try {
        // 1. Coletar os Dados
        // Em vez de ler relatórios, vamos buscar os dados direto do banco.
        // É muito mais eficiente. Buscamos, por exemplo, as operações dos últimos 30 dias.
        const operationsResult = await db.query(`
            SELECT * FROM operacoes 
            WHERE previsao_inicio_atendimento >= NOW() - INTERVAL '30 days'
            ORDER BY previsao_inicio_atendimento DESC
        `);
        const operationsData = operationsResult.rows;

        if (operationsData.length === 0) {
            return res.status(200).json({ analysis: "Nenhuma operação encontrada nos últimos 30 dias para analisar." });
        }

        // 2. Preparar o Prompt para o Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
            Você é um especialista em análise de operações logísticas e de transporte. 
            Analise os seguintes dados de operações em formato JSON. 
            Sua tarefa é gerar um resumo gerencial conciso, identificar os principais problemas e sugerir melhorias práticas.

            Dados das Operações:
            ${JSON.stringify(operationsData)}

            Por favor, gere uma análise com a seguinte estrutura em formato Markdown:

            ### Resumo Geral das Operações
            - Total de operações analisadas.
            - Percentual de operações "On Time" vs. "Atrasadas".
            - Tempo médio de atraso.

            ### Principais Pontos de Atenção
            - Identifique os 3 principais "Embarcadores" (nome_embarcador) com mais atrasos.
            - Identifique a "Justificativa de Atraso" (justificativa_atraso) mais comum.
            - Destaque qualquer operação com um atraso excepcionalmente alto (outlier).

            ### Recomendações e Melhorias
            - Com base nos dados, sugira 2 a 3 ações concretas que a equipe de gestão pode tomar para reduzir os atrasos.
            - Aponte possíveis áreas para investigação mais aprofundada.
        `;
        
        // 3. Chamar a API do Gemini
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisText = response.text();

        // 4. Retornar a Análise para o Frontend
        res.status(200).json({ analysis: analysisText });

    } catch (error) {
        console.error("Erro na análise de IA:", error);
        res.status(500).json({ message: "Ocorreu um erro ao gerar a análise de IA." });
    }
};