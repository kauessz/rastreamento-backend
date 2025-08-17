// ===============================
// client-dashboard.js — Portal do Cliente (versão completa)
// ===============================
// - Dark mode
// - Login Firebase
// - KPIs + Tabela com filtros e paginação
// - Integração com Assistente (Dialogflow Messenger):
//   * Define session-id no HTML como client:<companyId>:<email>
//   * Este JS preenche window.CLIENT_COMPANY_ID e window.AUTH_EMAIL
// - Botões para baixar Excel: Top 10 e Resumo de Atrasos
//
// Backend alvo
const API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
const PAGE_SIZE = 10;

// ====== DARK MODE ======
const themeToggle = document.getElementById('checkbox');
const body = document.body;
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  body.classList.add(savedTheme);
  if (savedTheme === 'dark-mode' && themeToggle) themeToggle.checked = true;
}
if (themeToggle) {
  themeToggle.addEventListener('change', () => {
    body.classList.toggle('dark-mode');
    localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark-mode' : 'light-mode');
  });
}

// ====== ELEMENTOS ======
const userEmailEl = document.getElementById('userEmail');
const kpiTotalEl = document.querySelector('#kpi-total .kpi-value');
const kpiOnTimeEl = document.querySelector('#kpi-ontime .kpi-value');
// CORRIGIDO: O ID no HTML é 'kpi-atrasadas', não 'kpiLate'
const kpiLateEl = document.querySelector('#kpi-atrasadas .kpi-value'); 
// CORRIGIDO: O ID no HTML é 'kpi-percentual', não 'kpiLatePct'
const kpiLatePctEl = document.querySelector('#kpi-percentual .kpi-value');

const bookingFilter = document.getElementById('bookingFilter');
const dataPrevisaoFilter = document.getElementById('dataPrevisaoFilter');
const filterButton = document.getElementById('filterButton');
const clearFilterButton = document.getElementById('clearFilterButton');

const tableEl = document.getElementById('clientOperationsTable');
//const tableEl = document.querySelector('clientOperationsTable') || document.querySelector('table');
const tableBodyEl = tableEl ? tableEl.querySelector('tbody') : null;
const paginationEl = document.getElementById('paginationControls') || document.getElementById('pagination');

// ====== ESTADO ======
let currentUser = null;
let currentToken = null;
let currentPage = 1;
let currentFilters = { booking: '', data_previsao: '' };

// Expostos globalmente p/ HTML do df-messenger
window.CLIENT_COMPANY_ID = window.CLIENT_COMPANY_ID || 0; // será preenchido por /api/client/profile
window.AUTH_EMAIL = window.AUTH_EMAIL || '';

// ====== UTILS ======
function fmtDateBR(iso) { try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso || '—'; } }
function safeText(v) { return (v === null || v === undefined || v === '') ? 'N/A' : String(v); }
function qs(obj) { const p = new URLSearchParams(); Object.entries(obj).forEach(([k,v]) => (v!==undefined&&v!==null&&v!=='') && p.append(k,v)); return p.toString(); }
function todayISO(d = new Date()) { return d.toISOString().slice(0,10); }
function defaultPeriod() { const end = new Date(); const start = new Date(Date.now() - 30*864e5); return { start: todayISO(start), end: todayISO(end) }; }

async function apiGet(path, withAuth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth && currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const resp = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
  return resp.json();
}

// ====== FIREBASE AUTH ======
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  if (userEmailEl) userEmailEl.textContent = `Olá, ${user.email}`;
  window.AUTH_EMAIL = user.email; // usado pelo df-messenger no HTML

  try { currentToken = await user.getIdToken(); }
  catch (e) { console.error('Erro ao obter token:', e); window.location.href = 'login.html'; return; }

  // Descobre o companyId do cliente (preenche window.CLIENT_COMPANY_ID)
  await resolveClientCompanyId();

  // Preenche período padrão nos inputs (se existirem)
  const def = defaultPeriod();
  document.getElementById('repStartClient')?.setAttribute('value', def.start);
  document.getElementById('repEndClient')?.setAttribute('value', def.end);

  // Vincula botões de Excel
  bindClientReportButtons();

  // Carrega KPIs e tabela
  await fetchClientKpis();
  await fetchClientOperations(1, currentFilters);
});

async function resolveClientCompanyId() {
  // 1) Se já está definido no HTML, respeita
  if (Number(window.CLIENT_COMPANY_ID) > 0) return;

  // 2) Busca do backend (requer authMiddleware no servidor)
  try {
    const profile = await apiGet('/api/client/profile'); // { embarcador_id, email, ... }
    if (profile && Number(profile.embarcador_id) > 0) {
      window.CLIENT_COMPANY_ID = Number(profile.embarcador_id);
      // opcional: sincroniza email
      if (!window.AUTH_EMAIL && profile.email) window.AUTH_EMAIL = profile.email;
      return;
    }
  } catch (e) {
    console.warn('Endpoint /api/client/profile indisponível:', e);
  }

  // 3) Sem companyId, mantém 0 (assistente não filtrará por empresa). Defina via HTML se precisar.
  console.warn('CLIENT_COMPANY_ID indefinido. Defina no HTML ou exponha /api/client/profile.');
}

// ====== KPIs ======
async function fetchClientKpis() {
  try {
    const data = await apiGet(`/api/client/kpis`);
    // Agora as atribuições funcionarão corretamente
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
  const query = qs({ page, pageSize: PAGE_SIZE, ...currentFilters });
  try {
    const payload = await apiGet(`/api/client/operations?${query}`);
    const list = payload.items || payload.rows || payload.data || [];
    const total = payload.total || 0;
    renderTable(list);
    renderPagination(total, page, PAGE_SIZE);
  } catch (e) {
    console.error('Erro ao buscar operações:', e);
    renderTable([]);
    renderPagination(0, 1, PAGE_SIZE);
  }
}

function renderTable(items) {
  if (!tableBodyEl) return;
  tableBodyEl.innerHTML = '';
  if (!items || !items.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 10; td.textContent = 'Nenhuma operação encontrada.';
    tr.appendChild(td); tableBodyEl.appendChild(tr);
    return;
  }

  items.forEach((op) => {
    const tr = document.createElement('tr');
    tr.className = 'operation-row';

    const cols = [
      safeText(op.numero_programacao),
      safeText(op.tipo_programacao),
      safeText(op.embarcador_nome || op.embarcador || ''),
      safeText(op.booking),
      safeText(op.containers),
      safeText(op.status_operacao),
      fmtDateBR(op.previsao_inicio_atendimento),
      fmtDateBR(op.dt_inicio_execucao),
      fmtDateBR(op.dt_fim_execucao)
    ];

    cols.forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });

    const tdActions = document.createElement('td');
    tdActions.innerHTML = `<button class="toggle-details">Detalhes</button>`;
    tr.appendChild(tdActions);
    tableBodyEl.appendChild(tr);

    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row hidden';
    const detailsTd = document.createElement('td');
    detailsTd.colSpan = 10;
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

// ====== EVENTOS ======
filterButton?.addEventListener('click', () => {
  fetchClientOperations(1, {
    booking: bookingFilter ? bookingFilter.value : '',
    data_previsao: dataPrevisaoFilter ? dataPrevisaoFilter.value : ''
  });
});

clearFilterButton?.addEventListener('click', () => {
  if (bookingFilter) bookingFilter.value = '';
  if (dataPrevisaoFilter) dataPrevisaoFilter.value = '';
  fetchClientOperations(1, { booking: '', data_previsao: '' });
});

paginationEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-goto]');
  if (!btn) return;
  const goto = Number(btn.getAttribute('data-goto') || '1');
  fetchClientOperations(goto, currentFilters);
});

// Toggle details
if (tableBodyEl) {
  tableBodyEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('.toggle-details');
    if (!toggle) return;
    const row = toggle.closest('tr');
    const next = row.nextElementSibling;
    if (next && next.classList.contains('details-row')) next.classList.toggle('hidden');
  });
}

// "Perguntar ao Assistente"
document.body.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ask-assistant');
  if (!btn) return;
  const q = btn.dataset.query || 'ajuda';
  try { await navigator.clipboard.writeText(q); } catch (_) {}
  if (window.openAssistant) {
    window.openAssistant();
  } else {
    const df = document.querySelector('df-messenger');
    if (df) df.setAttribute('expanded', 'true');
  }
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
  window.open(`${API_BASE_URL}${path}?${q}`, '_blank');
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
