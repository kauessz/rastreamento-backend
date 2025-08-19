// dashboard.js
(() => {
  const API_BASE = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";

  function debounce(fn, delay = 500) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), delay); }; }

  // ===== Theme
  const themeToggle = document.getElementById('checkbox'); const body = document.body;
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) { body.classList.add(savedTheme); if (savedTheme === 'dark-mode' && themeToggle) themeToggle.checked = true; }
  themeToggle?.addEventListener('change', () => { body.classList.toggle('dark-mode'); localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark-mode' : 'light-mode'); });

  // ===== Auth helpers
  async function getFreshToken(u) { try { return await u.getIdToken(); } catch { } try { return await u.getIdToken(true); } catch { } await u.reload(); return await u.getIdToken(true); }

  let currentToken = null, initRan = false;
  function initOnce() {
    if (initRan) return; initRan = true;
    const filters = getCurrentFilters();
    fetchPendingUsers();
    fetchOperations(1, filters);
    populateEmbarcadorFilter();
    fetchAndRenderKpis(filters);
    const def = adminDefaultPeriod();
    document.getElementById('repStart')?.setAttribute('value', def.start);
    document.getElementById('repEnd')?.setAttribute('value', def.end);
  }

  firebase.auth().onIdTokenChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }

    try {
      currentToken = await getFreshToken(user);

      // sem optional chaining na esquerda
      const el = document.getElementById('userEmail');
      if (el) el.textContent = user.email;

      initOnce();
    } catch (err) {
      console.error('getIdToken error:', err);
      setTimeout(async () => {
        const u = firebase.auth().currentUser;
        if (!u) { window.location.href = 'login.html'; return; }
        try {
          currentToken = await getFreshToken(u);

          const el2 = document.getElementById('userEmail');
          if (el2) el2.textContent = u.email;

          initOnce();
        } catch {
          alert('Não consegui confirmar sua sessão. Faça login novamente.');
          try { await firebase.auth().signOut(); } catch { }
          window.location.href = 'login.html';
        }
      }, 1200);
    }
  });
  document.getElementById('logoutButton')?.addEventListener('click', () => firebase.auth().signOut());

  // ===== Elements
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
  const aliasesTableBody = document.querySelector('#aliasesTable tbody');
  const clearOperationsButton = document.getElementById('clearOperationsButton');
  let currentSort = { column: 'previsao_inicio_atendimento', order: 'desc' };
  let masterEmbarcadoresList = [];

  // ===== Pending users (silencia 404)
  async function fetchPendingUsers() {
    const box = document.getElementById('pendingUsersList');
    if (!box) return;
    try {
      const r = await fetch(`${API_BASE}/api/users/pending`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (r.status === 404) { box.innerHTML = '—'; return; }
      if (!r.ok) { box.innerHTML = '—'; return; }
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) { box.innerHTML = '—'; return; }
      box.innerHTML = data.map(u => `<div>${u.email}</div>`).join('');
    } catch { box.innerHTML = '—'; }
  }

  // ===== Filtros
  function getCurrentFilters() { return { booking: bookingFilter?.value.trim() || '', embarcador_id: embarcadorFilter?.value || '', data_previsao: dataPrevisaoFilter?.value || '' }; }
  function applyFilters() { const f = getCurrentFilters(); currentSort = { column: 'previsao_inicio_atendimento', order: 'desc' }; fetchOperations(1, f); fetchAndRenderKpis(f); }
  filterButton?.addEventListener('click', applyFilters);
  clearFilterButton?.addEventListener('click', () => { if (bookingFilter) bookingFilter.value = ''; if (embarcadorFilter) embarcadorFilter.value = ''; if (dataPrevisaoFilter) dataPrevisaoFilter.value = ''; applyFilters(); });
  embarcadorFilter?.addEventListener('change', applyFilters);
  dataPrevisaoFilter?.addEventListener('change', applyFilters);
  bookingFilter?.addEventListener('input', debounce(applyFilters, 500));

  // ===== KPIs
  async function fetchAndRenderKpis(filters = {}) {
    if (!currentToken) return;
    const url = new URL(`${API_BASE}/api/dashboard/kpis`); Object.entries(filters).forEach(([k, v]) => v && url.searchParams.append(k, v));
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${currentToken}` } });
      const { kpis, grafico_ofensores, grafico_clientes_atraso } = await r.json();
      document.querySelector('#kpi-total .kpi-value').textContent = kpis.total_operacoes;
      document.querySelector('#kpi-ontime .kpi-value').textContent = kpis.operacoes_on_time;
      document.querySelector('#kpi-atrasadas .kpi-value').textContent = kpis.operacoes_atrasadas;
      document.querySelector('#kpi-percentual .kpi-value').textContent = `${kpis.percentual_atraso}%`;
      renderChart('ofensoresChart', 'bar', grafico_ofensores.labels, grafico_ofensores.data, 'Nº de Ocorrências', 'y');
      renderChart('clientesChart', 'bar', grafico_clientes_atraso.labels, grafico_clientes_atraso.data, 'Nº de Atrasos', 'y');
    } catch (e) { console.error(e); }
  }
  function renderChart(id, type, labels, data, label, axis = 'y') {
    const c = document.getElementById(id); if (!c) return;
    const ctx = c.getContext('2d'); const ex = Chart.getChart(c); if (ex) ex.destroy();
    new Chart(ctx, { type, data: { labels, datasets: [{ label, data, backgroundColor: 'rgba(54,162,235,1.0)', borderColor: 'rgba(54,162,235,1)', borderWidth: 1 }] }, options: { indexAxis: axis, responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true } } } });
  }

  // ===== Operações
  async function fetchOperations(page = 1, filters = {}) {
    if (!currentToken) return;
    operationsTableBody.innerHTML = `<tr><td colspan="9">Carregando...</td></tr>`;
    const url = new URL(`${API_BASE}/api/operations`);
    url.searchParams.append('page', page); url.searchParams.append('limit', 20);
    url.searchParams.append('sortBy', currentSort.column); url.searchParams.append('sortOrder', currentSort.order);
    Object.entries(filters).forEach(([k, v]) => v && url.searchParams.append(k, v));
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${currentToken}` } });
      const data = await r.json(); if (!r.ok) throw new Error(data.message || 'Erro ao buscar operações');
      renderOperationsTable(data.data); renderPaginationControls(data.pagination, filters); updateSortIndicators();
    } catch (e) { console.error('Erro ao buscar operações:', e); operationsTableBody.innerHTML = `<tr><td colspan="9" style="color:red;">${e.message}</td></tr>`; }
  }
  function renderOperationsTable(list) {
    operationsTableBody.innerHTML = '';
    if (!list?.length) { operationsTableBody.innerHTML = `<tr><td colspan="9">Nenhuma operação encontrada.</td></tr>`; return; }
    const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR') : 'N/A';
    list.forEach(op => {
      const main = document.createElement('tr'); main.className = 'main-row'; main.dataset.operationId = op.id;
      main.innerHTML = `
        <td>${op.booking || 'N/A'}</td>
        <td>${op.containers || 'N/A'}</td>
        <td>${op.nome_embarcador || 'N/A'}</td>
        <td>${op.porto || 'N/A'}</td>
        <td>${fmt(op.previsao_inicio_atendimento)}</td>
        <td>${fmt(op.dt_inicio_execucao)}</td>
        <td>${fmt(op.dt_fim_execucao)}</td>
        <td style="font-weight:bold;color:${op.atraso !== 'ON TIME' ? '#dc3545' : '#28a745'};">${op.atraso}</td>
        <td>${op.justificativa_atraso || 'N/A'}</td>`;
      const details = document.createElement('tr'); details.id = `details-${op.id}`; details.className = 'details-row';
      details.innerHTML = `<td colspan="9" class="details-content">
        <div class="details-wrapper">
          <span><strong>Nº Programação:</strong> ${op.numero_programacao || 'N/A'}</span>
          <span><strong>Tipo:</strong> ${op.tipo_programacao || 'N/A'}</span>
          <span><strong>Motorista:</strong> ${op.nome_motorista || 'N/A'}</span>
          <span><strong>Veículo:</strong> ${op.placa_veiculo || 'N/A'}</span>
          <span><strong>Carreta:</strong> ${op.placa_carreta || 'N/A'}</span>
          <button class="ask-assistant" data-query="status do ${op.containers ? 'container ' + op.containers : 'booking ' + (op.booking || '')}">Perguntar ao Assistente</button>
        </div></td>`;
      operationsTableBody.append(main, details);
    });
  }
  function renderPaginationControls(pag, filters) {
    paginationControls.innerHTML = ''; if (pag.totalPages <= 1) return;
    const prev = document.createElement('button'); prev.textContent = 'Anterior'; prev.disabled = pag.currentPage === 1; prev.onclick = () => fetchOperations(pag.currentPage - 1, filters);
    const next = document.createElement('button'); next.textContent = 'Próxima'; next.disabled = pag.currentPage === pag.totalPages; next.onclick = () => fetchOperations(pag.currentPage + 1, filters);
    const info = document.createElement('span'); info.textContent = `Página ${pag.currentPage} de ${pag.totalPages}`;
    paginationControls.append(prev, info, next);
  }
  operationsTableBody?.addEventListener('click', (e) => { const row = e.target.closest('.main-row'); if (!row) return; const d = document.getElementById(`details-${row.dataset.operationId}`); d?.classList.toggle('visible'); });
  operationsTableHead?.addEventListener('click', (e) => { const th = e.target.closest('th[data-sort]'); if (!th) return; const k = th.dataset.sort; currentSort = (currentSort.column === k) ? { column: k, order: (currentSort.order === 'asc' ? 'desc' : 'asc') } : { column: k, order: 'asc' }; fetchOperations(1, getCurrentFilters()); });
  function updateSortIndicators() { operationsTableHead?.querySelectorAll('th[data-sort]').forEach(th => { const base = th.textContent.replace(/ [▲▼↕]/, ''); th.textContent = base; th.textContent += (th.dataset.sort === currentSort.column) ? (currentSort.order === 'asc' ? ' ▲' : ' ▼') : ' ↕'; }); }

  // ===== Aliases (pendentes)
  async function fetchAndRenderAliases() {
    if (!currentToken) return;
    aliasesTableBody.innerHTML = `<tr><td colspan="4">Carregando apelidos...</td></tr>`;
    try {
      const r = await fetch(`${API_BASE}/api/embarcadores/aliases`, { headers: { Authorization: `Bearer ${currentToken}` } });
      let aliases = await r.json(); if (!r.ok) throw new Error(aliases?.message || 'Erro ao listar aliases.');
      aliases = (aliases || []).filter(a => !a.mestre_id && !a.mestre_nome);
      renderAliasesTable(aliases);
    } catch (e) { console.error(e); aliasesTableBody.innerHTML = `<tr><td colspan="4" style="color:red;">Erro ao listar aliases.</td></tr>`; }
  }
  function renderAliasesTable(aliases) {
    aliasesTableBody.innerHTML = ''; if (!aliases.length) { aliasesTableBody.innerHTML = `<tr><td colspan="4">Nenhum apelido pendente.</td></tr>`; return; }
    const opts = masterEmbarcadoresList.map(m => `<option value="${m.id}">${m.nome_principal}</option>`).join('');
    aliases.forEach(a => {
      const tr = document.createElement('tr'); tr.dataset.aliasId = a.id;
      tr.innerHTML = `<td>${a.nome_alias}</td><td>${a.mestre_nome || '-'}</td>
      <td><select class="reassign-select"><option value="">Selecione um novo mestre...</option>${opts}</select></td>
      <td><button class="button-reassign">Salvar</button> <button class="button-delete-alias button-secondary">Excluir</button></td>`;
      aliasesTableBody.appendChild(tr);
    });
  }
  aliasesTableBody?.addEventListener('click', async (e) => {
    const row = e.target.closest('tr'); if (!row) return; const id = row.dataset.aliasId;
    if (e.target.classList.contains('button-reassign')) {
      const sel = row.querySelector('.reassign-select'); const newMasterId = Number(sel?.value || 0); if (!newMasterId) { alert('Selecione um novo mestre.'); return; }
      if (!confirm('Confirmar reassociação?')) return;
      try {
        const r = await fetch(`${API_BASE}/api/embarcadores/aliases/${id}/reassign`, { method: 'PUT', headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ newMasterId }) });
        const out = await r.json(); if (!r.ok) throw new Error(out.message || 'Falha ao reassociar'); alert('Apelido reassociado com sucesso!'); fetchAndRenderAliases();
      } catch (e2) { alert(`Erro: ${e2.message}`); }
    }
    if (e.target.classList.contains('button-delete-alias')) {
      if (!confirm('Tem certeza que deseja EXCLUIR este apelido?')) return;
      try {
        const r = await fetch(`${API_BASE}/api/embarcadores/aliases/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${currentToken}` } });
        const out = await r.json(); if (!r.ok) throw new Error(out.message || 'Falha ao excluir'); alert('Apelido excluído com sucesso!'); fetchAndRenderAliases();
      } catch (e2) { alert(`Erro: ${e2.message}`); }
    }
  });
  async function populateEmbarcadorFilter() {
    try {
      const r = await fetch(`${API_BASE}/api/embarcadores`, { headers: { Authorization: `Bearer ${currentToken}` } });
      const list = await r.json(); if (!r.ok) throw new Error(list?.message || 'Falha ao buscar embarcadores');
      masterEmbarcadoresList = list; embarcadorFilter.innerHTML = '<option value="">Todos Embarcadores</option>';
      list.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.nome_principal; embarcadorFilter.appendChild(o); });
      fetchAndRenderAliases();
    } catch (e) { console.error(e); }
  }

  // ===== Upload & limpar
  uploadForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (!fileInput.files.length) { uploadMessage.textContent = 'Selecione um arquivo.'; return; }
    const fd = new FormData(); fd.append('file', fileInput.files[0]); uploadMessage.textContent = 'Enviando arquivo...';
    try {
      const r = await fetch(`${API_BASE}/api/operations/upload`, { method: 'POST', headers: { Authorization: `Bearer ${currentToken}` }, body: fd });
      const out = await r.json(); if (!r.ok) throw new Error(out.message || 'Falha no upload');
      uploadMessage.textContent = out.message + ' Atualizando dashboard...'; uploadForm.reset(); setTimeout(() => applyFilters(), 1200);
    } catch (e) { uploadMessage.textContent = `Erro: ${e.message}`; }
  });
  clearOperationsButton?.addEventListener('click', async () => {
    if (!confirm('Tem certeza que deseja apagar TODAS as operações?')) return;
    if (!confirm('Confirma novamente? Esta ação NÃO poderá ser desfeita.')) return;
    try {
      const r = await fetch(`${API_BASE}/api/operations/all`, { method: 'DELETE', headers: { Authorization: `Bearer ${currentToken}` } });
      const out = await r.json(); if (!r.ok) throw new Error(out.message); alert(out.message); applyFilters();
    } catch (e) { alert(`Erro: ${e.message}`); }
  });

  // ===== Assistente
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ask-assistant'); if (!btn) return;
    const q = btn.dataset.query || 'ajuda'; try { await navigator.clipboard.writeText(q); } catch { }
    document.querySelector('df-messenger')?.setAttribute('expanded', 'true');
    alert('Abri o assistente. Cole a pergunta no campo e envie:\n\n' + q);
  });

  // ===== Relatórios Excel
  function adminTodayISO(d = new Date()) { return d.toISOString().slice(0, 10); }
  function adminDefaultPeriod() { const end = new Date(); const start = new Date(Date.now() - 30 * 864e5); return { start: adminTodayISO(start), end: adminTodayISO(end) }; }
  function getAdminPeriod() { const s = document.getElementById('repStart')?.value; const e = document.getElementById('repEnd')?.value; if (!s || !e) return adminDefaultPeriod(); return { start: s, end: e }; }
  function openAdminReport(path, params) { const q = new URLSearchParams(params).toString(); window.open(`${API_BASE}${path}?${q}`, '_blank'); }
  (function bindExcel() {
    document.getElementById('btnExcelTop')?.addEventListener('click', () => { const { start, end } = getAdminPeriod(); openAdminReport('/api/reports/top-ofensores.xlsx', { start, end }); });
    document.getElementById('btnExcelAtrasos')?.addEventListener('click', () => { const { start, end } = getAdminPeriod(); openAdminReport('/api/reports/atrasos.xlsx', { start, end }); });
  })();
});