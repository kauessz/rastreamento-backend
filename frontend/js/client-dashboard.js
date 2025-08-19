// ===============================
// client-dashboard.js — Portal do Cliente (versão alinhada ao HTML)
// ===============================
const API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
const PAGE_SIZE = 10;

/* -------- Tema claro/escuro -------- */
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

/* -------- Elementos -------- */
const userEmailEl = document.getElementById('userEmail');

// KPIs conforme o HTML (valor fica dentro do .kpi-value)
const kpiTotalValue  = document.querySelector('#kpi-total .kpi-value');
const kpiOntimeValue = document.querySelector('#kpi-ontime .kpi-value');
const kpiLateValue   = document.querySelector('#kpi-atrasadas .kpi-value');
const kpiPctValue    = document.querySelector('#kpi-percentual .kpi-value');

// Filtros
const bookingFilter     = document.getElementById('bookingFilter');
const dataPrevisaoFilter= document.getElementById('dataPrevisaoFilter');
const filterButton      = document.getElementById('filterButton');
const clearFilterButton = document.getElementById('clearFilterButton');

// Tabela e paginação (6 colunas)
const tableBodyEl   = document.querySelector('#clientOperationsTable tbody');
const paginationEl  = document.getElementById('paginationControls');

/* -------- Estado -------- */
let currentUser  = null;
let currentToken = null;
let currentPage  = 1;
let currentFilters = { booking: '', data_previsao: '' };

// Expostos globalmente p/ df-messenger (o HTML usa isso p/ session-id)
window.CLIENT_COMPANY_ID = window.CLIENT_COMPANY_ID || 0;
window.AUTH_EMAIL        = window.AUTH_EMAIL || '';

/* -------- Utils -------- */
function fmtDateBR(iso) { try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; } }
function safe(v)       { return (v===null||v===undefined||v==='') ? 'N/A' : String(v); }
function qs(obj)       { const p=new URLSearchParams(); Object.entries(obj).forEach(([k,v])=>{ if(v!==undefined&&v!==null&&v!=='') p.append(k,v);}); return p.toString(); }
function todayISO(d=new Date()){ return d.toISOString().slice(0,10); }
function defaultPeriod(){ const end=new Date(); const start=new Date(Date.now()-30*864e5); return {start:todayISO(start), end:todayISO(end)}; }

async function apiGet(path, withAuth=true) {
  const headers = { 'Content-Type':'application/json' };
  if (withAuth && currentToken) headers.Authorization = `Bearer ${currentToken}`;
  const resp = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
  return resp.json();
}

/* -------- Auth Firebase -------- */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  window.AUTH_EMAIL = user.email;
  if (userEmailEl) userEmailEl.textContent = `Olá, ${user.email}`;

  try { currentToken = await user.getIdToken(); }
  catch (e) { console.error('Erro ao obter token:', e); window.location.href='login.html'; return; }

  await resolveClientCompanyId();

  // período padrão nos inputs do relatório
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
    }
  } catch (e) {
    console.warn('Endpoint /api/client/profile indisponível:', e);
  }
}

/* -------- KPIs -------- */
async function fetchClientKpis() {
  try {
    const data = await apiGet('/api/client/kpis');
    if (kpiTotalValue)  kpiTotalValue.textContent  = safe(data.total_operacoes);
    if (kpiOntimeValue) kpiOntimeValue.textContent = safe(data.operacoes_on_time);
    if (kpiLateValue)   kpiLateValue.textContent   = safe(data.operacoes_atrasadas);
    if (kpiPctValue)    kpiPctValue.textContent    = (data.percentual_atraso!=null ? `${data.percentual_atraso}%` : '0%');
  } catch (e) { console.error('Erro ao buscar KPIs:', e); }
}

/* -------- Tabela (6 colunas) -------- */
async function fetchClientOperations(page=1, filters={}) {
  currentPage = page;
  currentFilters = {
    booking: (filters.booking || '').trim(),
    data_previsao: (filters.data_previsao || '').trim()
  };
  const query = qs({ page, pageSize: PAGE_SIZE, ...currentFilters });
  try {
    const payload = await apiGet(`/api/client/operations?${query}`);
    const list  = payload.items || payload.rows || payload.data || [];
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
    td.colSpan = 6; td.textContent = 'Nenhuma operação encontrada.';
    tr.appendChild(td); tableBodyEl.appendChild(tr);
    return;
  }

  items.forEach(op => {
    // linha principal (6 colunas)
    const tr = document.createElement('tr');
    tr.className = 'operation-row';
    [
      safe(op.booking),
      safe(op.containers),
      safe(op.status_operacao || op.status || 'N/A'),
      fmtDateBR(op.previsao_inicio_atendimento),
      fmtDateBR(op.dt_inicio_execucao),
      fmtDateBR(op.dt_fim_execucao)
    ].forEach(txt => { const td=document.createElement('td'); td.textContent=txt; tr.appendChild(td); });
    tableBodyEl.appendChild(tr);

    // linha de detalhes (abaixo)
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row'; // começa fechada (CSS controla com display:none)
    const detailsTd = document.createElement('td');
    detailsTd.colSpan = 6;
    detailsTd.innerHTML = `
      <div class="details-wrapper">
        <span><strong>Nº Programação:</strong> ${safe(op.numero_programacao)}</span>
        <span><strong>Tipo:</strong> ${safe(op.tipo_programacao)}</span>
        <span><strong>Motorista:</strong> ${safe(op.nome_motorista)}</span>
        <span><strong>Veículo:</strong> ${safe(op.placa_veiculo)}</span>
        <span><strong>Carreta:</strong> ${safe(op.placa_carreta)}</span>
        <button class="ask-assistant"
          data-query="status do ${op.containers ? ('container ' + op.containers) : ('booking ' + (op.booking || ''))}">
          Perguntar ao Assistente
        </button>
      </div>`;
    detailsRow.appendChild(detailsTd);
    tableBodyEl.appendChild(detailsRow);
  });
}

// toggle por clique na própria linha
tableBodyEl?.addEventListener('click', (e) => {
  const row = e.target.closest('tr.operation-row');
  if (!row) return;
  const details = row.nextElementSibling;
  if (details && details.classList.contains('details-row')) {
    details.classList.toggle('visible'); // .details-row.visible => display: table-row
  }
});

function renderPagination(total, page, pageSize) {
  if (!paginationEl) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = Math.max(1, page - 1), next = Math.min(totalPages, page + 1);
  paginationEl.innerHTML = `
    <div class="pagination">
      <button ${page === 1 ? 'disabled' : ''} data-goto="${prev}">Anterior</button>
      <span>Página ${page} de ${totalPages}</span>
      <button ${page === totalPages ? 'disabled' : ''} data-goto="${next}">Próxima</button>
    </div>`;
}
paginationEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-goto]'); if (!btn) return;
  fetchClientOperations(Number(btn.dataset.goto || '1'), currentFilters);
});

/* -------- Filtros -------- */
filterButton?.addEventListener('click', () => {
  fetchClientOperations(1, {
    booking: bookingFilter?.value || '',
    data_previsao: dataPrevisaoFilter?.value || ''
  });
});
clearFilterButton?.addEventListener('click', () => {
  if (bookingFilter) bookingFilter.value = '';
  if (dataPrevisaoFilter) dataPrevisaoFilter.value = '';
  fetchClientOperations(1, { booking:'', data_previsao:'' });
});

/* -------- Assistente -------- */
document.body.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ask-assistant');
  if (!btn) return;
  const q = btn.dataset.query || 'ajuda';
  try { await navigator.clipboard.writeText(q); } catch {}
  const df = document.querySelector('df-messenger');
  if (df) df.setAttribute('expanded', 'true');
  alert('Abri o assistente. Cole a pergunta e envie:\n\n' + q);
});

/* -------- Relatórios (Excel) -------- */
function getPeriodClient() {
  const s = document.getElementById('repStartClient')?.value;
  const e = document.getElementById('repEndClient')?.value;
  if (!s || !e) return defaultPeriod();
  return { start: s, end: e };
}
function openReport(path, params){ const q=new URLSearchParams(params).toString(); window.open(`${API_BASE_URL}${path}?${q}`, '_blank'); }
function bindClientReportButtons(){
  document.getElementById('btnExcelTopClient')?.addEventListener('click', () => {
    const {start,end}=getPeriodClient(); const companyId=window.CLIENT_COMPANY_ID||0;
    openReport('/api/reports/top-ofensores.xlsx',{start,end,companyId});
  });
  document.getElementById('btnExcelAtrasosClient')?.addEventListener('click', () => {
    const {start,end}=getPeriodClient(); const companyId=window.CLIENT_COMPANY_ID||0;
    openReport('/api/reports/atrasos.xlsx',{start,end,companyId});
  });
}