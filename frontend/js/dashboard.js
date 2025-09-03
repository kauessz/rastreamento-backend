// ========= Util =========
const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

const API_BASE =
  (document.querySelector('meta[name="api-base"]')?.content || '').replace(/\/$/, '') + '/api';

function fmtDateISO(dmy) {
  // dd/mm/aaaa -> aaaa-mm-dd
  if (!dmy) return '';
  const [d,m,y] = dmy.split('/');
  if (!y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

async function authToken() {
  const u = firebase.auth().currentUser;
  if (!u) throw new Error('Não autenticado');
  return u.getIdToken(true);
}

async function apiGet(path, params={}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k,v]) => (v!=null && v!=='') && url.searchParams.set(k,v));
  const token = await authToken();
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ========= Tema =========
(function themeBoot() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = $('#themeToggle');
  if (btn) {
    btn.textContent = (saved === 'dark' ? '☀️' : '🌙');
    btn.addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      localStorage.setItem('theme', now);
      btn.textContent = (now === 'dark' ? '☀️' : '🌙');
    });
  }
})();

// ========= Estado =========
let currentPage = 1;
let offendersChart, clientsChart;

// ========= Render =========
function renderAliases(list) {
  const tbody = $('#aliasTbody');
  if (!list?.length) {
    tbody.innerHTML = `<tr><td colspan="3">Nenhum apelido.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(a => `
    <tr>
      <td>${a.dirty_name}</td>
      <td>${a.master_name || '—'}</td>
      <td><button class="btn btn-ghost" data-del="${a.id}">Excluir</button></td>
    </tr>
  `).join('');
}

function renderKpis(k) {
  $('#kpiTotal').textContent  = k.total || 0;
  $('#kpiOnTime').textContent = k.on_time || 0;
  $('#kpiLate').textContent   = k.late || 0;
  const pct = (k.total ? ((k.late||0) / k.total * 100) : 0).toFixed(2) + '%';
  $('#kpiPct').textContent = pct;
}

function renderBars(canvasId, labels, data) {
  const ctx = $(canvasId).getContext('2d');
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Ocorrências', data }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } }
    }
  });
  return chart;
}

function renderOps(list) {
  const c = $('#opsContainer');
  if (!list?.length) {
    c.innerHTML = `<div class="muted">Nenhuma operação encontrada.</div>`;
    return;
  }
  const rows = list.map(o => `
    <details class="row">
      <summary class="row-head">
        <div class="cell">${o.booking || '—'}</div>
        <div class="cell">${o.container || '—'}</div>
        <div class="cell">${o.client_name || '—'}</div>
        <div class="cell">${o.port || '—'}</div>
        <div class="cell">${o.scheduled_at || '—'}</div>
        <div class="cell">${o.started_at || '—'}</div>
        <div class="cell">${o.finished_at || '—'}</div>
        <div class="cell">${o.delay_hhmm || '—'}</div>
        <div class="cell">${o.delay_reason || '—'}</div>
      </summary>
      <div class="row-body">
        <div><strong>Tipo de Operação:</strong> ${o.operation_type || '—'}</div>
        <div><strong>Status:</strong> ${o.status || '—'}</div>
        <div><strong>Nº Programação:</strong> ${o.program_number || '—'}</div>
        <div><strong>Motorista:</strong> ${o.driver_name || '—'}</div>
        <div><strong>CPF do Motorista:</strong> ${o.driver_cpf || '—'}</div>
        <div><strong>Placa Veículo:</strong> ${o.truck_plate || '—'}</div>
        <div><strong>Placa Carreta:</strong> ${o.trailer_plate || '—'}</div>
        <div><strong>Nº do Cliente:</strong> ${o.client_number || '—'}</div>
      </div>
    </details>
  `).join('');
  c.innerHTML = `
    <div class="table ops">
      <div class="row row-head stick">
        <div class="cell">Booking</div>
        <div class="cell">Contêiner</div>
        <div class="cell">Embarcador</div>
        <div class="cell">Porto</div>
        <div class="cell">Previsão Atendimento</div>
        <div class="cell">Início Execução</div>
        <div class="cell">Fim Execução</div>
        <div class="cell">Atraso (HH:MM)</div>
        <div class="cell">Motivo do Atraso</div>
      </div>
      ${rows}
    </div>
  `;
}

// ========= Carregadores =========
async function loadAliases() {
  try {
    const data = await apiGet('/aliases');
    renderAliases(data);
  } catch (e) {
    $('#aliasTbody').innerHTML = `<tr><td colspan="3">Erro ao carregar apelidos.</td></tr>`;
    console.error('aliases', e);
  }
}

async function loadKpisAndCharts() {
  try {
    const params = readFilters();
    const data = await apiGet('/dashboard/kpis', params);
    renderKpis(data.kpis || data);

    // gráficos (usa data.charts se existir, senão ignora)
    if (offendersChart) offendersChart.destroy();
    if (clientsChart)   clientsChart.destroy();

    if (data.offenders?.length) {
      offendersChart = renderBars('#chartOffenders',
        data.offenders.map(i => i.label),
        data.offenders.map(i => i.value)
      );
    }
    if (data.clients?.length) {
      clientsChart = renderBars('#chartClients',
        data.clients.map(i => i.label),
        data.clients.map(i => i.value)
      );
    }
  } catch (e) {
    console.error('kpis/charts', e);
  }
}

function readFilters() {
  return {
    companyId: $('#fCompany').value || '',
    booking:   $('#fBooking').value || '',
    container: $('#fContainer').value || '',
    start:     fmtDateISO($('#fStart').value),
    end:       fmtDateISO($('#fEnd').value),
    page:      currentPage,
    limit:     50
  };
}

async function loadOperations() {
  try {
    const params = readFilters();
    const data = await apiGet('/operations', params);
    renderOps(data.items || data.rows || data);
  } catch (e) {
    $('#opsContainer').innerHTML = `<div class="muted">Falha ao carregar operações.</div>`;
    console.error('operations', e);
  }
}

// ========= Ações UI =========
function bindUI() {
  $('#btnLogout')?.addEventListener('click', () => firebase.auth().signOut());

  $('#btnFilter')?.addEventListener('click', async () => {
    currentPage = 1;
    await Promise.all([loadKpisAndCharts(), loadOperations()]);
  });

  $('#btnClear')?.addEventListener('click', async () => {
    $('#fCompany').value = '';
    $('#fBooking').value = '';
    $('#fContainer').value = '';
    $('#fStart').value = '';
    $('#fEnd').value = '';
    currentPage = 1;
    await Promise.all([loadKpisAndCharts(), loadOperations()]);
  });

  $('#prevPage')?.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--;
      await loadOperations();
    }
  });
  $('#nextPage')?.addEventListener('click', async () => {
    currentPage++;
    await loadOperations();
  });

  $('#aliasSave')?.addEventListener('click', async () => {
    try {
      const dirty  = $('#aliasDirty').value.trim();
      const master = $('#aliasMaster').value.trim();
      if (!dirty || !master) return alert('Preencha os dois campos.');
      const token = await authToken();
      const res = await fetch(API_BASE + '/aliases', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization':`Bearer ${token}`
        },
        body: JSON.stringify({ dirty_name: dirty, master_name: master })
      });
      if (!res.ok) throw new Error(await res.text());
      $('#aliasDirty').value = '';
      $('#aliasMaster').value = '';
      loadAliases();
    } catch (e) {
      alert('Falha ao salvar apelido.');
      console.error(e);
    }
  });
}

// ========= Boot =========
firebase.auth().onAuthStateChanged(async (user) => {
  try {
    if (!user) {
      location.href = '/login.html';
      return;
    }
    $('#userEmail').textContent = user.email || '—';

    bindUI();

    // Carrega dados iniciais
    await Promise.all([
      loadAliases(),
      loadKpisAndCharts(),
      loadOperations()
    ]);
  } catch (e) {
    console.error('init', e);
  }
});