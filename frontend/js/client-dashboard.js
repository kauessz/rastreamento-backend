// ===============================
// client-dashboard.js — Portal do Cliente (corrigido)
// ===============================

// Base da API (sem redeclarar a global)
const API_BASE = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
const PAGE_SIZE = 10;

// ====== DARK MODE ======
const themeToggle = document.getElementById('checkbox');
const body = document.body;
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  body.classList.add(savedTheme);
  if (savedTheme === 'dark-mode' && themeToggle) themeToggle.checked = true;
}
themeToggle?.addEventListener('change', () => {
  body.classList.toggle('dark-mode');
  localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark-mode' : 'light-mode');
});

// ====== ELEMENTOS ======
const userEmailEl = document.getElementById('userEmail');
const kpiTotalEl = document.querySelector('#kpi-total .kpi-value');
const kpiOnTimeEl = document.querySelector('#kpi-ontime .kpi-value');
const kpiLateEl = document.querySelector('#kpi-atrasadas .kpi-value');
const kpiLatePctEl = document.querySelector('#kpi-percentual .kpi-value');

const bookingFilter = document.getElementById('bookingFilter');
const dataPrevisaoFilter = document.getElementById('dataPrevisaoFilter');
const filterButton = document.getElementById('filterButton');
const clearFilterButton = document.getElementById('clearFilterButton');

const tableEl = document.getElementById('clientOperationsTable') || document.getElementById('operationsTable') || document.querySelector('table');
const tableBodyEl = tableEl ? tableEl.querySelector('tbody') : null;
const paginationEl = document.getElementById('paginationControls') || document.getElementById('pagination');

// ====== ESTADO ======
let currentToken = null;
let currentPage = 1;
let currentFilters = { booking: '', data_previsao: '' };

window.CLIENT_COMPANY_ID = window.CLIENT_COMPANY_ID || 0;
window.AUTH_EMAIL = window.AUTH_EMAIL || '';

// ====== UTILS ======
function fmtDateBR(v) {
  if (!v) return 'N/A';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('pt-BR');
}
function safeText(v) { return (v === null || v === undefined || v === '') ? 'N/A' : String(v); }
function qs(obj) { const p = new URLSearchParams(); Object.entries(obj).forEach(([k,v]) => (v!==undefined&&v!==null&&v!=='') && p.append(k,v)); return p.toString(); }
function todayISO(d = new Date()) { return d.toISOString().slice(0,10); }
function defaultPeriod() { const end = new Date(); const start = new Date(Date.now() - 30*864e5); return { start: todayISO(start), end: todayISO(end) }; }

async function apiGet(path, withAuth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth && currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const resp = await fetch(`${API_BASE}${path}`, { headers });
  if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
  return resp.json();
}

// ====== FIREBASE AUTH ======
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  if (userEmailEl) userEmailEl.textContent = `Olá, ${user.email}`;
  window.AUTH_EMAIL = user.email;

  try { currentToken = await user.getIdToken(); }
  catch (e) { console.error('Erro ao obter token:', e); window.location.href = 'login.html'; return; }

  await resolveClientCompanyId();

  const def = defaultPeriod();
  document.getElementById('repStartClient')?.setAttribute('value', def.start);
  document.getElementById('repEndClient')?.setAttribute('value', def.end);
  bindClientReportButtons();

  await fetchClientKpis();
  await fetchClientOperations(1, currentFilters);
});

async function resolveClientCompanyId() {
  if (Number(window.CLIENT_COMPANY_ID) > 0) return;
  try {
    const profile = await apiGet('/api/client/profile');
    if (profile && Number(profile.embarcador_id) > 0) {
      window.CLIENT_COMPANY_ID = Number(profile.embarcador_id);
      if (!window.AUTH_EMAIL && profile.email) window.AUTH_EMAIL = profile.email;
      return;
    }
  } catch (e) { console.warn('Endpoint /api/client/profile indisponível:', e); }
  console.warn('CLIENT_COMPANY_ID indefinido. Defina no HTML ou exponha /api/client/profile.');
}

// ====== KPIs ======
async function fetchClientKpis() {
  try {
    const data = await apiGet(`/api/client/kpis`);
    if (kpiTotalEl) kpiTotalEl.textContent = safeText(data.total_operacoes);
    if (kpiOnTimeEl) kpiOnTimeEl.textContent = safeText(data.operacoes_on_time);
    if (kpiLateEl) kpiLateEl.textContent = safeText(data.operacoes_atrasadas);
    if (kpiLatePctEl) kpiLatePctEl.textContent = (data.percentual_atraso !== undefined ? `${data.percentual_atraso}%` : '—');
  } catch (e) { console.error('Erro ao buscar KPIs:', e); }
}

// ====== TABELA ======
async function fetchClientOperations(page = 1, filters = {}) {
  currentPage = page;
  currentFilters = { booking: (filters.booking || '').trim(), data_previsao: (filters.data_previsao || '').trim() };

  const baseParams = { page, pageSize: PAGE_SIZE, ...currentFilters };
  if (Number(window.CLIENT_COMPANY_ID) > 0) baseParams.companyId = Number(window.CLIENT_COMPANY_ID);
  const query = qs(baseParams);

  try {
    const payload = await apiGet(`/api/client/operations?${query}`);
    const list = payload.items || payload.rows || payload.data || [];
    const total = payload.total || 0;
    renderTable(list);
    renderPagination(total, page, PAGE_SIZE);
  } catch (e) {
    console.error('Erro ao buscar operações:', e);
    if (tableBodyEl) tableBodyEl.innerHTML = `<tr><td colspan="6" style="color:red;">${e.message}</td></tr>`;
    renderPagination(0, 1, PAGE_SIZE);
  }
}

function renderTable(items) {
  if (!tableBodyEl) return;
  tableBodyEl.innerHTML = '';
  if (!items || !items.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6; td.textContent = 'Nenhuma operação encontrada.';
    tr.appendChild(td); tableBodyEl.appendChild(tr);
    return;
  }

  items.forEach((op) => {
    // linha principal (6 colunas)
    const tr = document.createElement('tr');
    tr.className = 'operation-row';
    [
      safeText(op.booking),
      safeText(op.containers),
      safeText(op.status_operacao || op.status || 'N/A'),
      fmtDateBR(op.previsao_inicio_atendimento),
      fmtDateBR(op.dt_inicio_execucao),
      fmtDateBR(op.dt_fim_execucao)
    ].forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
    tableBodyEl.appendChild(tr);

    // linha de detalhes
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row hidden';
    const detailsTd = document.createElement('td');
    detailsTd.colSpan = 6;
    detailsTd.innerHTML = `
      <div class="details-wrapper">
        <span><strong>Nº Programação:</strong> ${safeText(op.numero_programacao)}</span>
        <span><strong>Tipo:</strong> ${safeText(op.tipo_programacao)}</span>
        <span><strong>Motorista:</strong> ${safeText(op.nome_motorista)}</span>
        <span><strong>Veículo:</strong> ${safeText(op.placa_veiculo)}</span>
        <span><strong>Carreta:</strong> ${safeText(op.placa_carreta)}</span>
        <button class="ask-assistant"
          data-query="status do ${op.containers ? ('container ' + op.containers) : ('booking ' + (op.booking || ''))}">
          Perguntar ao Assistente
        </button>
      </div>`;
    detailsRow.appendChild(detailsTd);
    tableBodyEl.appendChild(detailsRow);
  });
}

function renderPagination(total, page, pageSize) {
  if (!paginationEl) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  paginationEl.innerHTML = `
    <div class="pagination">
      <button ${page === 1 ? 'disabled' : ''} data-goto="${prev}">Anterior</button>
      <span>Página ${page} de ${totalPages}</span>
      <button ${page === totalPages ? 'disabled' : ''} data-goto="${next}">Próxima</button>
    </div>`;
}

// Toggle de detalhes: clique na linha principal
tableBodyEl?.addEventListener('click', (e) => {
  const row = e.target.closest('tr.operation-row');
  if (!row) return;
  const next = row.nextElementSibling;
  if (next && next.classList.contains('details-row')) {
    next.classList.toggle('hidden');
  }
});

// “Perguntar ao Assistente”
document.body.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ask-assistant'); if (!btn) return;
  const q = btn.dataset.query || 'ajuda';
  try { await navigator.clipboard.writeText(q); } catch {}
  document.querySelector('df-messenger')?.setAttribute('expanded', 'true');
  alert('Abri o assistente. Cole a pergunta e envie:\n\n' + q);
});

// ====== Botões de EXCEL (Cliente) ======
function getPeriodClient() {
  const s = document.getElementById('repStartClient')?.value;
  const e = document.getElementById('repEndClient')?.value;
  if (!s || !e) return defaultPeriod();
  return { start: s, end: e };
}
function openReport(path, params) {
  const q = new URLSearchParams(params).toString();
  window.open(`${API_BASE}${path}?${q}`, '_blank');
}
function bindClientReportButtons() {
  const btnTop = document.getElementById('btnExcelTopClient');
  const btnAtrasos = document.getElementById('btnExcelAtrasosClient');
  btnTop?.addEventListener('click', () => {
    const { start, end } = getPeriodClient();
    const companyId = window.CLIENT_COMPANY_ID || 0;
    openReport('/api/reports/top-ofensores.xlsx', { start, end, companyId });
  });
  btnAtrasos?.addEventListener('click', () => {
    const { start, end } = getPeriodClient();
    const companyId = window.CLIENT_COMPANY_ID || 0;
    openReport('/api/reports/atrasos.xlsx', { start, end, companyId });
  });
}

// Botão “Sair”
document.getElementById('logoutButton')?.addEventListener('click', async () => {
  try { await firebase.auth().signOut(); } catch (e) { console.error(e); }
});
