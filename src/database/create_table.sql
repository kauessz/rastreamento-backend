-- Apaga a tabela antiga para podermos recriá-la com as novas colunas
-- CUIDADO: Isso apaga todos os dados que possam existir nela!
DROP TABLE IF EXISTS operacoes;

-- Recria a tabela 'operacoes' com a estrutura baseada na sua planilha
CREATE TABLE IF NOT EXISTS operacoes (
    id SERIAL PRIMARY KEY,

    -- Colunas da sua planilha
    booking VARCHAR(100),
    containers TEXT, -- Usando TEXT para acomodar múltiplos containers
    pol VARCHAR(100), -- Port of Loading
    pod VARCHAR(100), -- Port of Discharge
    tipo_programacao VARCHAR(100),
    previsao_inicio_atendimento TIMESTAMPTZ,
    dt_inicio_execucao TIMESTAMPTZ,
    dt_fim_execucao TIMESTAMPTZ,
    dt_previsao_entrega_recalculada TIMESTAMPTZ,
    nome_motorista VARCHAR(255),
    placa_veiculo VARCHAR(20),
    placa_carreta VARCHAR(20),
    cpf_motorista VARCHAR(14),
    justificativa_atraso TEXT,

    -- Colunas de controle e vínculo do sistema
    embarcador_id INTEGER NOT NULL, -- Chave estrangeira para a tabela 'embarcadores'
    status_operacao VARCHAR(100) DEFAULT 'Programado', -- Status geral da operação
    motivo_atraso VARCHAR(255), -- Causa raiz para o gráfico de ofensores
    data_criacao TIMESTAMPTZ DEFAULT NOW(),
    data_atualizacao TIMESTAMPTZ DEFAULT NOW(),

    -- Vínculo com a tabela de embarcadores
    FOREIGN KEY (embarcador_id) REFERENCES embarcadores(id) ON DELETE CASCADE
);

-- Opcional: Criar um gatilho (trigger) para atualizar 'data_atualizacao' automaticamente
CREATE OR REPLACE FUNCTION update_changetimestamp_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.data_atualizacao = NOW(); 
   RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_operacoes_changetimestamp BEFORE UPDATE
ON operacoes FOR EACH ROW EXECUTE PROCEDURE 
update_changetimestamp_column();