// =========================================================================================
//                                     dashboard.js (Versão Definitiva)
// =========================================================================================

// --- FUNÇÃO DE OTIMIZAÇÃO (DEBOUNCE) ---
function debounce(func, delay = 500) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// --- LÓGICA DO DARK MODE ---
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

// --- LÓGICA PRINCIPAL DO DASHBOARD ---
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. SELEÇÃO DOS ELEMENTOS DO HTML ---
    const userEmail = document.getElementById('userEmail');
    const logoutButton = document.getElementById('logoutButton');
    const pendingUsersList = document.getElementById('pendingUsersList');
    const operationsTableBody = document.querySelector('#operationsTable tbody');
    const operationsTableHead = document.querySelector('#operationsTable thead');
    const paginationControls = document.getElementById('paginationControls');
    const filterButton = document.getElementById('filterButton');
    const clearFilterButton = document.getElementById('clearFilterButton');
    const bookingFilter = document.getElementById('bookingFilter');
    const embarcadorFilter = document.getElementById('embarcadorFilter');
    const dataPrevisaoFilter = document.getElementById('dataPrevisaoFilter');
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadMessage = document.getElementById('uploadMessage');
    const kpiContainer = document.querySelector('.kpi-container');

    // ===== CORREÇÃO DEFINITIVA: Capturamos o "contexto de desenho" dos canvas UMA VEZ. =====
    const ofensoresCtx = document.getElementById('ofensoresChart').getContext('2d');
    const clientesCtx = document.getElementById('clientesChart').getContext('2d');

    let currentToken = null;
    let currentSort = { column: 'previsao_inicio_atendimento', order: 'desc' };
    window.ofensoresChart = null;
    window.clientesChart = null;

    // --- 2. AUTENTICAÇÃO E CARGA INICIAL DOS DADOS ---
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            userEmail.textContent = user.email;
            try {
                currentToken = await user.getIdToken();
                loadInitialData();
            } catch (error) {
                console.error("Erro ao obter o token:", error);
                window.location.href = 'login.html';
            }
        } else {
            window.location.href = 'login.html';
        }
    });

    logoutButton.addEventListener('click', () => auth.signOut());

    function loadInitialData() {
        // A versão com setTimeout não é mais necessária com a nova abordagem de contexto
        const filters = getCurrentFilters();
        fetchPendingUsers();
        fetchOperations(1, filters);
        populateEmbarcadorFilter();
        fetchAndRenderKpis(filters);
    }

    // --- 3. LÓGICA DE UPLOAD DE ARQUIVO ---
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!fileInput.files.length) {
            uploadMessage.textContent = 'Por favor, selecione um arquivo.'; return;
        }
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        uploadMessage.textContent = 'Enviando arquivo...';
        try {
            const response = await fetch('http://localhost:3001/api/operations/upload', {
                method: 'POST', headers: { 'Authorization': `Bearer ${currentToken}` }, body: formData,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            uploadMessage.textContent = result.message + " Atualizando dashboard...";
            uploadForm.reset();
            setTimeout(loadInitialData, 2000);
        } catch (error) {
            uploadMessage.textContent = `Erro: ${error.message}`;
        }
    });

    // --- 4. LÓGICA DOS FILTROS GLOBAIS ---
    async function populateEmbarcadorFilter() {
        try {
            const response = await fetch('http://localhost:3001/api/embarcadores', { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (!response.ok) throw new Error('Falha ao buscar embarcadores.');
            const embarcadores = await response.json();
            embarcadorFilter.innerHTML = '<option value="">Todos Embarcadores</option>';
            embarcadores.forEach(emb => {
                const option = document.createElement('option');
                option.value = emb.id;
                option.textContent = emb.nome_principal;
                embarcadorFilter.appendChild(option);
            });
        } catch (error) { console.error(error); }
    }

    function getCurrentFilters() {
        return {
            booking: bookingFilter.value.trim(),
            embarcador_id: embarcadorFilter.value,
            data_previsao: dataPrevisaoFilter.value,
        };
    }

    function applyFilters() {
        const filters = getCurrentFilters();
        currentSort = { column: 'previsao_inicio_atendimento', order: 'desc' };
        fetchOperations(1, filters);
        fetchAndRenderKpis(filters);
    }

    filterButton.addEventListener('click', applyFilters);
    clearFilterButton.addEventListener('click', () => {
        bookingFilter.value = ''; embarcadorFilter.value = ''; dataPrevisaoFilter.value = '';
        applyFilters();
    });

    embarcadorFilter.addEventListener('change', applyFilters);
    dataPrevisaoFilter.addEventListener('change', applyFilters);
    bookingFilter.addEventListener('input', debounce(applyFilters, 500));

    // --- 5. LÓGICA DE KPIs E GRÁFICOS ---
    async function fetchAndRenderKpis(filters = {}) {
        if (!currentToken) return;

        // Constrói a URL com os parâmetros de filtro
        const url = new URL('http://localhost:3001/api/dashboard/kpis');
        Object.keys(filters).forEach(key => {
            if (filters[key]) {
                url.searchParams.append(key, filters[key]);
            }
        });

        try {
            const response = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!response.ok) throw new Error('Falha ao buscar KPIs.');
            const { kpis, grafico_ofensores, grafico_clientes_atraso } = await response.json();

            document.querySelector('#kpi-total .kpi-value').textContent = kpis.total_operacoes;
            document.querySelector('#kpi-ontime .kpi-value').textContent = kpis.operacoes_on_time;
            document.querySelector('#kpi-atrasadas .kpi-value').textContent = kpis.operacoes_atrasadas;
            document.querySelector('#kpi-percentual .kpi-value').textContent = `${kpis.percentual_atraso}%`;

            // Passamos as instâncias do gráfico para a função e recebemos as novas de volta
            window.ofensoresChart = renderChart(window.ofensoresChart, 'ofensoresChart', 'bar', grafico_ofensores.labels, grafico_ofensores.data, 'Nº de Ocorrências', 'y');
            window.clientesChart = renderChart(window.clientesChart, 'clientesChart', 'bar', grafico_clientes_atraso.labels, grafico_clientes_atraso.data, 'Nº de Atrasos', 'y');

        } catch (error) { console.error(error); }
    }

    function renderChart(chartInstance, canvasId, type, labels, data, label, axis = 'y') {
        const ctx = document.getElementById(canvasId).getContext('2d');
        if (window[canvasId] instanceof Chart) {
            window[canvasId].destroy();
        }
        window[canvasId] = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{ label: label, data: data, backgroundColor: 'rgba(54, 162, 235, 1.0)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }]
            },
            options: {
                indexAxis: axis,
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { beginAtZero: true } },
                layout: {
                    padding: {
                        left: 50,
                        right: 30
                    }
                }
            }
        });
    }

    kpiContainer.addEventListener('click', (event) => {
        const kpiCard = event.target.closest('.kpi-card');
        if (kpiCard && kpiCard.dataset.filter) {
            const statusFilter = kpiCard.dataset.filter === 'total' ? null : kpiCard.dataset.filter;
            const filters = { ...getCurrentFilters(), status: statusFilter };
            fetchOperations(1, filters);
        }
    });

    // --- 6. LÓGICA DA TABELA DE OPERAÇÕES ---
    async function fetchOperations(page = 1, filters = {}) {
        if (!currentToken) return;
        operationsTableBody.innerHTML = `<tr><td colspan="9">Carregando...</td></tr>`;
        let url = new URL('http://localhost:3001/api/operations');
        url.searchParams.append('page', page);
        url.searchParams.append('limit', 20);
        url.searchParams.append('sortBy', currentSort.column);
        url.searchParams.append('sortOrder', currentSort.order);
        Object.keys(filters).forEach(key => {
            if (filters[key]) url.searchParams.append(key, filters[key]);
        });
        try {
            const response = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (!response.ok) throw new Error((await response.json()).message);
            const result = await response.json();
            renderOperationsTable(result.data);
            renderPaginationControls(result.pagination, filters);
            updateSortIndicators();
        } catch (error) {
            console.error("Erro ao buscar operações:", error);
            operationsTableBody.innerHTML = `<tr><td colspan="9" style="color: red;">${error.message}</td></tr>`;
        }
    }

    function renderOperationsTable(operations) {
        operationsTableBody.innerHTML = '';
        if (operations.length === 0) {
            operationsTableBody.innerHTML = `<tr><td colspan="9">Nenhuma operação encontrada.</td></tr>`;
            return;
        }
        const formatarData = (data) => data ? new Date(data).toLocaleString('pt-BR') : 'N/A';
        operations.forEach(op => {
            const mainRow = document.createElement('tr');
            mainRow.classList.add('main-row');
            mainRow.style.cursor = 'pointer';
            mainRow.dataset.operationId = op.id;
            mainRow.innerHTML = `
                <td>${op.booking || 'N/A'}</td><td>${op.containers || 'N/A'}</td><td>${op.nome_embarcador || 'N/A'}</td>
                <td>${op.porto || 'N/A'}</td><td>${formatarData(op.previsao_inicio_atendimento)}</td>
                <td>${formatarData(op.dt_inicio_execucao)}</td><td>${formatarData(op.dt_fim_execucao)}</td>
                <td style="font-weight: bold; color: ${op.atraso !== 'ON TIME' ? '#dc3545' : '#28a745'};">${op.atraso}</td>
                <td>${op.motivo_atraso || 'N/A'}</td>
            `;
            const detailsRow = document.createElement('tr');
            detailsRow.classList.add('details-row');
            detailsRow.id = `details-${op.id}`;
            detailsRow.innerHTML = `<td colspan="9" class="details-content"><div class="details-wrapper">
                <span><strong>Nº Programação:</strong> ${op.numero_programacao || 'N/A'}</span>
                <span><strong>Tipo:</strong> ${op.tipo_programacao || 'N/A'}</span>
                <span><strong>Motorista:</strong> ${op.nome_motorista || 'N/A'}</span>
                <span><strong>Veículo:</strong> ${op.placa_veiculo || 'N/A'}</span>
                <span><strong>Carreta:</strong> ${op.placa_carreta || 'N/A'}</span>
            </div></td>`;
            operationsTableBody.append(mainRow, detailsRow);
        });
    }

    function renderPaginationControls(pagination, filters) {
        paginationControls.innerHTML = '';
        if (pagination.totalPages <= 1) return;
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Anterior';
        prevButton.disabled = pagination.currentPage === 1;
        prevButton.addEventListener('click', () => { fetchOperations(pagination.currentPage - 1, filters); });
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Próxima';
        nextButton.disabled = pagination.currentPage === pagination.totalPages;
        nextButton.addEventListener('click', () => { fetchOperations(pagination.currentPage + 1, filters); });
        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Página ${pagination.currentPage} de ${pagination.totalPages}`;
        paginationControls.append(prevButton, pageInfo, nextButton);
    }

    operationsTableBody.addEventListener('click', (event) => {
        const row = event.target.closest('.main-row');
        if (row) {
            const detailsRow = document.getElementById(`details-${row.dataset.operationId}`);
            if (detailsRow) detailsRow.classList.toggle('visible');
        }
    });

    operationsTableHead.addEventListener('click', (event) => {
        const headerCell = event.target.closest('th');
        if (!headerCell || !headerCell.dataset.sort) return;
        const sortKey = headerCell.dataset.sort;
        if (currentSort.column === sortKey) {
            currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.column = sortKey;
            currentSort.order = 'asc';
        }
        fetchOperations(1, getCurrentFilters());
    });

    function updateSortIndicators() {
        operationsTableHead.querySelectorAll('th[data-sort]').forEach(th => {
            th.innerHTML = th.dataset.sort.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); // Reset text
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSort.column) {
                th.classList.add(currentSort.order === 'asc' ? 'sort-asc' : 'sort-desc');
                th.innerHTML += currentSort.order === 'asc' ? ' ▲' : ' ▼';
            }
        });
    }

    // --- 7. LÓGICA DE APROVAÇÃO DE USUÁRIOS ---
    async function fetchPendingUsers() {
        if (!currentToken) return;
        try {
            const response = await fetch('http://localhost:3001/api/users/admin/pending', { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (!response.ok) throw new Error((await response.json()).message);
            const users = await response.json();
            renderPendingUsers(users);
        } catch (error) {
            console.error("Erro ao buscar usuários pendentes:", error);
            pendingUsersList.innerHTML = `<p style="color: red;">${error.message}</p>`;
        }
    }

    function renderPendingUsers(users) {
        pendingUsersList.innerHTML = '';
        if (users.length === 0) {
            pendingUsersList.innerHTML = '<p>Nenhum usuário aguardando aprovação.</p>';
            return;
        }
        const list = document.createElement('ul');
        users.forEach(user => {
            const item = document.createElement('li');
            item.innerHTML = `<span>${user.nome} (${user.email})</span><button class="approve-btn" data-userid="${user.id}">Aprovar</button>`;
            list.appendChild(item);
        });
        pendingUsersList.appendChild(list);
        list.addEventListener('click', (event) => {
            if (event.target.classList.contains('approve-btn')) {
                approveUser(event.target.dataset.userid);
            }
        });
    }

    async function approveUser(userId) {
        if (!confirm('Tem certeza que deseja aprovar este usuário?')) return;
        try {
            const response = await fetch(`http://localhost:3001/api/users/admin/approve/${userId}`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!response.ok) throw new Error((await response.json()).message);
            alert('Usuário aprovado com sucesso!');
            fetchPendingUsers();
        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    }

    // --- 8. LÓGICA DO BOTÃO DE LIMPAR OPERAÇÕES ---
    const clearOperationsButton = document.getElementById('clearOperationsButton');

    clearOperationsButton.addEventListener('click', async () => {
        // DUPLA CONFIRMAÇÃO PARA UMA AÇÃO DESTRUTIVA
        const firstConfirm = confirm("Tem certeza ABSOLUTA que deseja apagar TODAS as operações? Esta ação não pode ser desfeita.");
        
        if (firstConfirm) {
            const secondConfirm = confirm("Esta é sua última chance. Confirma a exclusão de TODOS os dados de operações?");

            if (secondConfirm) {
                try {
                    const response = await fetch('http://localhost:3001/api/operations/all', {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${currentToken}` },
                    });

                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);

                    alert(result.message);
                    loadInitialData(); // Atualiza o dashboard, que agora estará vazio

                } catch (error) {
                    alert(`Erro: ${error.message}`);
                    console.error("Erro ao limpar operações:", error);
                }
            }
        }
    });
});