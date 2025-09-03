// src/public/js/dashboard.js
(() => {
  const API = window.API_BASE || ''; // ex.: '' quando o front e back estão no mesmo host
  const token = localStorage.getItem('idToken');

  // ------------- Helpers -------------
  function authHeaders() {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
  function fmtDate(d) {
    if (!d) return 'N/A';
    try {
      const dt = new Date(d);
      return isNaN(dt) ? 'N/A' : dt.toLocaleString();
    } catch { return 'N/A'; }
  }

  // ------------- Filtros (UI) -------------
  const $embarcador = document.getElementById('filter-embarcador');
  const $booking    = document.getElementById('filter-booking');
  const $container  = document.getElementById('filter-container');
  const $date       = document.getElementById('filter-date'); // dd/mm/aaaa

  document.getElementById('btn-filter')?.addEventListener('click', () => {
    loadKpisAndCharts();
    loadOperations();
  });
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    [$embarcador,$booking,$container,$date].forEach(i => i && (i.value=''));
    loadKpisAndCharts();
    loadOperations();
  });

  function getFilters() {
    const payload = {};
    if ($embarcador?.value && $embarcador.value !== '0') payload.embarcador_id = $embarcador.value;
    if ($booking?.value)   payload.booking   = $booking.value.trim();
    if ($container?.value) payload.container = $container.value.trim();
    if ($date?.value) {
      const [dd,mm,aa] = $date.value.split('/');
      if (dd && mm && aa) payload.data_previsao = `${aa}-${mm}-${dd}`;
    }
    return payload;
  }

  // ------------- KPIs & Gráficos -------------
  let offendersChart = null;
  let clientsChart   = null;

  async function loadKpisAndCharts() {
    try {
      const params = new URLSearchParams(getFilters()).toString();
      const res = await fetch(`${API}/api/dashboard/kpis?${params}`, { headers: authHeaders() });
      const json = await res.json();

      // KPIs
      document.getElementById('kpi-total').innerText    = json.kpis?.total_operacoes ?? 0;
      document.getElementById('kpi-ontime').innerText   = json.kpis?.operacoes_on_time ?? 0;
      document.getElementById('kpi-late').innerText     = json.kpis?.operacoes_atrasadas ?? 0;
      document.getElementById('kpi-percent').innerText  = `${json.kpis?.percentual_atraso ?? 0}%`;

      // Gráfico 1 — Top 10 Ofensores de Atraso
      const ctx1 = document.getElementById('chart-offenders').getContext('2d');
      if (offendersChart) offendersChart.destroy();
      offendersChart = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: json.grafico_ofensores?.labels ?? [],
          datasets: [{ data: json.grafico_ofensores?.data ?? [] }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } }
          }
        }
      });

      // Gráfico 2 — Top 10 Clientes com Atraso
      const ctx2 = document.getElementById('chart-clients-late').getContext('2d');
      if (clientsChart) clientsChart.destroy();
      clientsChart = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: json.grafico_clientes_atraso?.labels ?? [],
          datasets: [{ data: json.grafico_clientes_atraso?.data ?? [] }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } }
          }
        }
      });
    } catch (e) {
      console.error('KPIs/Charts error', e);
    }
  }

  // ------------- Lista de Operações -------------
  const $tbody = document.querySelector('#ops-table tbody');

  async function loadOperations() {
    try {
      const base = getFilters();
      const params = new URLSearchParams({ ...base, page: 1, limit: 50 }).toString();
      const res = await fetch(`${API}/api/operations?${params}`, { headers: authHeaders() });
      const json = await res.json();
      renderOps(json.data || []);
    } catch (e) {
      console.error('ops list error', e);
    }
  }

  function renderOps(rows) {
    if (!$tbody) return;
    $tbody.innerHTML = '';
    for (const op of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${op.booking || 'N/A'}</td>
        <td>${op.containers || 'N/A'}</td>
        <td>${op.nome_embarcador || 'N/A'}</td>
        <td>${op.porto || 'N/A'}</td>
        <td>${fmtDate(op.previsao_inicio_atendimento)}</td>
        <td>${fmtDate(op.dt_inicio_execucao)}</td>
        <td>${fmtDate(op.dt_fim_execucao)}</td>
        <td>${op.atraso || 'N/A'}</td>
        <td>${op.justificativa_atraso || 'N/A'}</td>
      `;
      // detalhe
      const detail = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 9;
      td.innerHTML = `
        <div class="row-detail">
          <strong>Tipo de Operação:</strong> ${op.tipo_programacao || 'N/A'} &nbsp;&nbsp;
          <strong>Status:</strong> ${op.atraso === 'ON TIME' ? 'No prazo' : 'Atrasada'} &nbsp;&nbsp;
          <strong>Nº Programação:</strong> ${op.numero_programacao || 'N/A'}<br/>
          <strong>Motorista:</strong> ${op.nome_motorista || 'N/A'} &nbsp;&nbsp;
          <strong>CPF do Motorista:</strong> ${op.cpf_motorista || 'N/A'} &nbsp;&nbsp;
          <strong>Placa Veículo:</strong> ${op.placa_veiculo || 'N/A'} &nbsp;&nbsp;
          <strong>Placa Carreta:</strong> ${op.placa_carreta || 'N/A'} &nbsp;&nbsp;
          <strong>Nº Cliente:</strong> ${op.numero_cliente || 'N/A'}
        </div>`;
      detail.appendChild(td);
      detail.style.display = 'none';

      tr.addEventListener('click', () => {
        detail.style.display = (detail.style.display === 'none' ? '' : 'none');
      });

      $tbody.appendChild(tr);
      $tbody.appendChild(detail);
    }
  }

  // ------------- Modais OnTime/Atrasadas -------------
  async function openModal(status) {
    const base = getFilters();
    const params = new URLSearchParams({ ...base, status, page: 1, limit: 200 }).toString();
    const res = await fetch(`${API}/api/operations?${params}`, { headers: authHeaders() });
    const json = await res.json();
    renderModal(status === 'on_time' ? 'Operações On Time' : 'Operações Atrasadas', json.data || []);
  }

  function renderModal(title, rows) {
    const modal = document.getElementById('modal');
    const header = modal.querySelector('.modal-title');
    const body = modal.querySelector('.modal-body');
    header.textContent = title;
    if (!rows.length) {
      body.innerHTML = `<p>Nenhuma operação.</p>`;
    } else {
      body.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>Booking</th><th>Contêiner</th><th>Embarcador</th>
              <th>Prev. Atendimento</th><th>Início Execução</th><th>Fim Execução</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(op => `
              <tr>
                <td>${op.booking||'N/A'}</td>
                <td>${op.containers||'N/A'}</td>
                <td>${op.nome_embarcador||'N/A'}</td>
                <td>${fmtDate(op.previsao_inicio_atendimento)}</td>
                <td>${fmtDate(op.dt_inicio_execucao)}</td>
                <td>${fmtDate(op.dt_fim_execucao)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    }
    modal.style.display = 'block';
  }
  document.getElementById('btn-close-modal')?.addEventListener('click', () => {
    document.getElementById('modal').style.display = 'none';
  });
  document.getElementById('kpi-card-ontime')?.addEventListener('click', () => openModal('on_time'));
  document.getElementById('kpi-card-late')?.addEventListener('click', () => openModal('atrasadas'));

  // ------------- Gerenciador de Apelidos -------------
  async function loadAliases() {
    const res = await fetch(`${API}/api/aliases`, { headers: authHeaders() });
    const rows = await res.json();
    const tb = document.querySelector('#aliasTable tbody');
    if (!tb) return;
    tb.innerHTML = rows.map(r => `<tr><td>${r.alias}</td><td>${r.master}</td></tr>`).join('');
  }

  document.getElementById('aliasForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alias  = document.getElementById('alias').value.trim();
    const master = document.getElementById('master').value.trim();
    if (!alias || !master) return alert('Preencha alias e mestre.');
    const res = await fetch(`${API}/api/aliases`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ alias, master })
    });
    if (!res.ok) {
      const j = await res.json().catch(()=>({}));
      return alert(j.error || 'Falha ao salvar.');
    }
    document.getElementById('alias').value = '';
    document.getElementById('master').value = '';
    loadAliases();
  });

  // ------------- Init -------------
  loadKpisAndCharts();
  loadOperations();
  loadAliases();
})();
