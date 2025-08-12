// frontend/js/main.js

// LÓGICA DO DARK MODE
const themeToggle = document.getElementById('checkbox');
const body = document.body;

// Verifica se há um tema salvo no navegador (localStorage)
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
    body.classList.add(savedTheme);
    // Marca o checkbox se o tema salvo for escuro
    if (savedTheme === 'dark-mode') {
        themeToggle.checked = true;
    }
}

// Adiciona um "ouvinte" para o evento de mudança (clique) no interruptor
themeToggle.addEventListener('change', () => {
    // Adiciona ou remove a classe 'dark-mode' do <body>
    body.classList.toggle('dark-mode');

    // Salva a preferência do usuário no navegador
    if (body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark-mode');
    } else {
        localStorage.removeItem('theme');
        localStorage.setItem('theme', 'light-mode'); // Opcional, para salvar o modo claro também
    }
});


// Espera o HTML ser totalmente carregado para começar a executar o script.
document.addEventListener('DOMContentLoaded', () => {

    // 1. PEGANDO OS ELEMENTOS DO HTML
    // Pegamos referências aos elementos com os quais vamos interagir.
    const searchButton = document.getElementById('searchButton');
    const trackingInput = document.getElementById('trackingInput');
    const resultsContainer = document.getElementById('resultsContainer');
    
    // O endereço base da nossa API. Facilita se precisarmos mudar depois.
    const API_URL = 'http://localhost:3001/api/operations/public/track/';

    // 2. ADICIONANDO UM "OUVINTE" DE EVENTO
    // Dizemos ao botão de busca para executar a função 'handleSearch' quando for clicado.
    searchButton.addEventListener('click', handleSearch);

    // Também permite buscar pressionando "Enter" no campo de input.
    trackingInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            handleSearch();
        }
    });

    // 3. A FUNÇÃO DE BUSCA
    // Esta é uma função 'async' porque ela precisa esperar a resposta da API.
    async function handleSearch() {
        const trackingCode = trackingInput.value.trim(); // Pega o valor do input e remove espaços em branco.

        // Se o campo de busca estiver vazio, não faz nada.
        if (!trackingCode) {
            resultsContainer.innerHTML = '<p>Por favor, digite um código de rastreamento.</p>';
            return;
        }

        // Mostra uma mensagem de "carregando" enquanto a busca é feita.
        resultsContainer.innerHTML = '<p>Buscando...</p>';

        try {
            // 'fetch' é a forma moderna do JavaScript de fazer requisições de rede (chamar APIs).
            // Usamos `await` para esperar a resposta antes de continuar.
            const response = await fetch(API_URL + trackingCode);

            // Se a resposta não for 'OK' (ex: erro 404 - não encontrado), mostra uma mensagem de erro.
            if (!response.ok) {
                resultsContainer.innerHTML = `<p>Operação não encontrada para o código: ${trackingCode}</p>`;
                return;
            }

            // Se a resposta for 'OK', convertemos os dados da resposta para o formato JSON.
            const data = await response.json();
            
            // Chamamos a função que exibe os resultados na tela.
            displayResults(data);

        } catch (error) {
            // Se houver um erro de rede (ex: API fora do ar), mostra uma mensagem de erro.
            console.error('Erro de rede:', error);
            resultsContainer.innerHTML = '<p>Não foi possível conectar ao servidor. Tente novamente mais tarde.</p>';
        }
    }

    // 4. A FUNÇÃO PARA EXIBIR OS RESULTADOS
    function displayResults(operations) {
        // Limpa a área de resultados antes de adicionar os novos.
        resultsContainer.innerHTML = '';

        // Se o array de operações estiver vazio, mostra a mensagem de não encontrado.
        if (operations.length === 0) {
            resultsContainer.innerHTML = '<p>Nenhuma operação encontrada.</p>';
            return;
        }

        // Para cada operação encontrada na lista, cria um "card" de HTML.
        operations.forEach(op => {
            // 'toLocaleDateString' formata a data para um padrão mais legível.
            const formatarData = (data) => data ? new Date(data).toLocaleString('pt-BR') : 'N/A';

            const card = `
                <div class="result-card">
                    <p><strong>Embarcador:</strong> ${op.nome_embarcador || 'N/A'}</p> <p><strong>Booking:</strong> ${op.booking || 'N/A'}</p>
                    <p><strong>Contêiner(es):</strong> ${op.containers || 'N/A'}</p>
                    <p><strong>Status Atual:</strong> ${op.status_operacao || 'N/A'}</p>
                    <p><strong>Tipo de Programação:</strong> ${op.tipo_programacao || 'N/A'}</p>
                    <p><strong>Motorista:</strong> ${op.nome_motorista || 'N/A'}</p>
                    <p><strong>CPF:</strong> ${op.cpf_motorista || 'N/A'}</p>
                    <p><strong>Placa Veículo:</strong> ${op.placa_veiculo || 'N/A'}</p>
                    <p><strong>Placa Carreta:</strong> ${op.placa_carreta || 'N/A'}</p>
                    <p><strong>Data Programada:</strong> ${formatarData(op.previsao_inicio_atendimento)}</p>
                    <p><strong>Início da Execução:</strong> ${formatarData(op.dt_inicio_execucao)}</p>
                    <p><strong>Fim da Execução:</strong> ${formatarData(op.dt_fim_execucao)}</p>
                </div>
            `;
            // Adiciona o card recém-criado dentro da área de resultados.
            resultsContainer.innerHTML += card;
        });
    }
});