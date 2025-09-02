-- ATENÇÃO: este script apaga e recria 'operacoes'
DROP TABLE IF EXISTS operacoes;

-- Garante a existência de 'embarcadores' para FK (nome simples)
CREATE TABLE IF NOT EXISTS embarcadores (
  id SERIAL PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL
);

-- Recria a tabela 'operacoes' com as colunas necessárias ao front/analytics
CREATE TABLE IF NOT EXISTS operacoes (
    id SERIAL PRIMARY KEY,

    -- Identificação
    booking VARCHAR(100),
    containers TEXT,                           -- pode conter múltiplos
    numero_programacao VARCHAR(100),

    -- Portos / Local
    porto VARCHAR(100),                        -- usado no front
    pol VARCHAR(100),                          -- Port of Loading (opcional)
    pod VARCHAR(100),                          -- Port of Discharge (opcional)

    -- Datas principais
    previsao_inicio_atendimento TIMESTAMPTZ,
    dt_inicio_execucao TIMESTAMPTZ,
    dt_fim_execucao TIMESTAMPTZ,
    dt_previsao_entrega_recalculada TIMESTAMPTZ,

    -- Motorista / Veículos
    nome_motorista VARCHAR(255),
    motorista_nome VARCHAR(255),               -- compatibilidade (o front tenta ambos)
    cpf_motorista VARCHAR(14),
    placa_veiculo VARCHAR(20),
    placa_carreta VARCHAR(20),

    -- Transportadora / Cliente
    transportadora TEXT,
    nome_embarcador TEXT,                      -- usado pelo front e gráficos
    embarcador_id INTEGER,                     -- FK opcional

    -- Status / Motivos / Atraso
    status_operacao VARCHAR(100) DEFAULT 'Programado',
    motivo_atraso TEXT,
    justificativa_atraso TEXT,
    tempo_atraso INTEGER DEFAULT 0,            -- atraso em minutos (preferencial nos cálculos)
    atraso_hhmm VARCHAR(16),                   -- "HH:MM" ou "ON TIME" (fallback nos cálculos)
    tipo_operacao VARCHAR(100),
    tipo_programacao VARCHAR(100),

    -- Multi-empresa (opcional)
    company_id INTEGER,

    -- Auditoria
    data_criacao TIMESTAMPTZ DEFAULT NOW(),
    data_atualizacao TIMESTAMPTZ DEFAULT NOW(),

    -- FK
    CONSTRAINT fk_operacoes_embarcadores
      FOREIGN KEY (embarcador_id) REFERENCES embarcadores(id) ON DELETE SET NULL
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_operacoes_previsao ON operacoes (DATE(previsao_inicio_atendimento));
CREATE INDEX IF NOT EXISTS idx_operacoes_booking  ON operacoes (booking);
CREATE INDEX IF NOT EXISTS idx_operacoes_cliente  ON operacoes (nome_embarcador);
CREATE INDEX IF NOT EXISTS idx_operacoes_company  ON operacoes (company_id);

-- Gatilho para atualizar 'data_atualizacao'
CREATE OR REPLACE FUNCTION update_changetimestamp_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.data_atualizacao = NOW();
   RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_operacoes_changetimestamp ON operacoes;
CREATE TRIGGER update_operacoes_changetimestamp
BEFORE UPDATE ON operacoes
FOR EACH ROW EXECUTE PROCEDURE update_changetimestamp_column();