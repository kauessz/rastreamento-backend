// Em: frontend/js/client-dashboard.js (substitua tudo)

// Lógica do Dark Mode
const themeToggle = document.getElementById('checkbox');
const body = document.body;
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
    body.classList.add(savedTheme);
    if (savedTheme === 'dark-mode') themeToggle.checked = true;
}
themeToggle.addEventListener('change', () => {
    body.classList.toggle('dark-mode');
    localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark-mode' : 'light-mode');
});

document.addEventListener('DOMContentLoaded', () => {
    const userEmail = document.getElementById('userEmail');
    const logoutButton = document.getElementById('logoutButton');
    const tableBody = document.querySelector('#clientOperationsTable tbody');
    const paginationControls = document.getElementById('paginationControls');
    const filterButton = document.getElementById('filterButton');
    const clearFilterButton = document.getElementById('clearFilterButton');
    const bookingFilter = document.getElementById('bookingFilter');
    const dataPrevisaoFilter = document.getElementById('dataPrevisaoFilter');

    let currentToken = null;

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            userEmail.textContent = `Olá, ${user.email}`;
            try {
                currentToken = await user.getIdToken();
                fetchClientKpis();
                fetchClientOperations();
            } catch (error) {
                console.error("Erro ao obter token:", error);
                window.location.href = 'login.html';
            }
        } else {
            window.location.href = 'login.html';
        }
    });

    logoutButton.addEventListener('click', () => auth.signOut());

    async function fetchClientKpis() {
        try {
            const response = await fetch('http://localhost:3001/api/client/kpis', {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!response.ok) throw new Error('Falha ao buscar KPIs.');
            const kpis = await response.json();
            document.querySelector('#kpi-total .kpi-value').textContent = kpis.total_operacoes;
            document.querySelector('#kpi-ontime .kpi-value').textContent = kpis.operacoes_on_time;
            document.querySelector('#kpi-atrasadas .kpi-value').textContent = kpis.operacoes_atrasadas;
            document.querySelector('#kpi-percentual .kpi-value').textContent = `${kpis.percentual_atraso}%`;
        } catch(error) {
            console.error("Erro ao buscar KPIs do cliente:", error);
        }
    }

    async function fetchClientOperations(page = 1, filters = {}) {
        tableBody.innerHTML = `<tr><td colspan="6">Carregando suas operações...</td></tr>`;
        let url = new URL('http://localhost:3001/api/client/operations');
        url.searchParams.append('page', page);
        url.searchParams.append('limit', 20);
        if (filters.booking) url.searchParams.append('booking', filters.booking);
        if (filters.data_previsao) url.searchParams.append('data_previsao', filters.data_previsao);

        try {
            const response = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!response.ok) { throw new Error((await response.json()).message); }
            const result = await response.json();
            renderTable(result.data);
            renderPaginationControls(result.pagination, filters);
        } catch (error) {
            console.error("Erro ao buscar operações do cliente:", error);
            tableBody.innerHTML = `<tr><td colspan="6" style="color: red;">${error.message}</td></tr>`;
        }
    }

    function renderTable(operations) {
        tableBody.innerHTML = '';
        if (operations.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6">Nenhuma operação encontrada para sua conta.</td></tr>`;
            return;
        }
        const formatarData = (data) => data ? new Date(data).toLocaleString('pt-BR') : 'N/A';
        operations.forEach(op => {
            const mainRow = document.createElement('tr');
            mainRow.classList.add('main-row');
            mainRow.style.cursor = 'pointer';
            mainRow.dataset.operationId = op.id;
            mainRow.innerHTML = `
                <td>${op.booking || 'N/A'}</td>
                <td>${op.containers || 'N/A'}</td>
                <td>${op.status_operacao || 'N/A'}</td>
                <td>${formatarData(op.previsao_inicio_atendimento)}</td>
                <td>${formatarData(op.dt_inicio_execucao)}</td>
                <td>${formatarData(op.dt_fim_execucao)}</td>
            `;
            
            const detailsRow = document.createElement('tr');
            detailsRow.classList.add('details-row');
            detailsRow.id = `details-${op.id}`;
            detailsRow.innerHTML = `<td colspan="6" class="details-content"><div class="details-wrapper">
                <span><strong>Nº Programação:</strong> ${op.numero_programacao || 'N/A'}</span>
                <span><strong>Tipo:</strong> ${op.tipo_programacao || 'N/A'}</span>
                <span><strong>Motorista:</strong> ${op.nome_motorista || 'N/A'}</span>
                <span><strong>Veículo:</strong> ${op.placa_veiculo || 'N/A'}</span>
                <span><strong>Carreta:</strong> ${op.placa_carreta || 'N/A'}</span>
            </div></td>`;

            tableBody.append(mainRow, detailsRow);
        });
    }

    tableBody.addEventListener('click', (event) => {
        const row = event.target.closest('.main-row');
        if (row) {
            const detailsRow = document.getElementById(`details-${row.dataset.operationId}`);
            if (detailsRow) detailsRow.classList.toggle('visible');
        }
    });

    function renderPaginationControls(pagination, filters) {
        paginationControls.innerHTML = '';
        if (pagination.totalPages <= 1) return;
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Anterior';
        prevButton.disabled = pagination.currentPage === 1;
        prevButton.addEventListener('click', () => { fetchClientOperations(pagination.currentPage - 1, filters); });
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Próxima';
        nextButton.disabled = pagination.currentPage === pagination.totalPages;
        nextButton.addEventListener('click', () => { fetchClientOperations(pagination.currentPage + 1, filters); });
        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Página ${pagination.currentPage} de ${pagination.totalPages}`;
        paginationControls.append(prevButton, pageInfo, nextButton);
    }
    
    function applyClientFilters() {
        const filters = {
            booking: bookingFilter.value.trim(),
            data_previsao: dataPrevisaoFilter.value,
        };
        fetchClientOperations(1, filters);
    }

    filterButton.addEventListener('click', applyClientFilters);
    clearFilterButton.addEventListener('click', () => {
        bookingFilter.value = '';
        dataPrevisaoFilter.value = '';
        applyClientFilters();
    });
});