/* ========= Config ========= */
// Troque abaixo para o seu Render quando estiver em produção:
const API_BASE =
  window.API_BASE ||
  'https://rastreamento-backend-05pi.onrender.com/api'; // <- ajuste se o seu host for outro

/* ========= DOM helpers ========= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ========= Elementos usados ========= */
const userEmailEl   = $('#userEmail');
const aliasesBody   = $('#aliasesBody');
const aliasInput    = $('#aliasInput');
const masterInput   = $('#masterInput');
const aliasSaveBtn  = $('#aliasSaveBtn');
const aliasMsg      = $('#aliasMsg');

const embarcadorSel = $('#embarcadorFilter');
const bookingInp    = $('#bookingFilter');
const containerInp  = $('#containerFilter');
const startInp      = $('#startDateFilter');
const endInp        = $('#endDateFilter');
const filterBtn     = $('#filterButton');
const clearBtn      = $('#clearFilterButton');

const kpiTotalValue = $('#kpiTotalValue');
const kpiOnTimeValue= $('#kpiOnTimeValue');
const kpiLateValue  = $('#kpiLateValue');
const kpiPctValue   = $('#kpiPctValue');

const ofChartCanvas = $('#ofensoresChart');
const clChartCanvas = $('#clientesChart');

const repStart      = $('#repStart');
const repEnd        = $('#repEnd');
const btnExcelTop   = $('#btnExcelTop');
const btnExcelAtrasos = $('#btnExcelAtrasos');

const tableBodyEl   = $('#operationsBody');
const prevPageBtn   = $('#prevPage');
const nextPageBtn   = $('#nextPage');
const navReportsBtn = $('#navReports');

/* ========= Estado ========= */
let currentUser  = null;
let currentToken = null;
let page         = 1;
const PAGE_SIZE  = 50;
let currentFilters = {};
let allOpsCache   = []; // usado para popular embarcadores e fallback de gráficos
let offendersChart = null;
let clientsChart   = null;

/* ========= Utils ========= */
const safe = (v) => (v==null || v==='') ? 'N/A' : String(v);
const fmt  = (iso) => { try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; } };
const qs   = (o) => { const p=new URLSearchParams(); for (const [k,v] of Object.entries(o)) if(v!=null && v!=='') p.append(k,v); return p.toString(); };
const todayISO = () => (new Date()).toISOString().slice(0,10);
const defaultPeriod = () => { const end=todayISO(); const s=new Date(Date.now()-30*864e5).toISOString().slice(0,10); return {start:s,end}; };

async function authHeader() {
  if (!currentUser) throw new Error('no-user');
  if (!currentToken) currentToken = await currentUser.getIdToken(true);
  return { 'Authorization': `Bearer ${currentToken}` };
}

async function apiGet(path, params) {
  const url = params ? `${API_BASE}${path}?${qs(params)}` : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', ...(await authHeader()) },
    body: JSON.stringify(body||{})
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json().catch(()=> ({}));
}

function setKpis(total, onTime, late) {
  const pct = total ? Math.round((late/total)*10000)/100 : 0;
  if (kpiTotalValue)  kpiTotalValue.textContent  = total ?? 0;
  if (kpiOnTimeValue) kpiOnTimeValue.textContent = onTime ?? 0;
  if (kpiLateValue)   kpiLateValue.textContent   = late ?? 0;
  if (kpiPctValue)    kpiPctValue.textContent    = `${pct}%`;
}

function drawHorizontalBar(canvas, labels, data, title) {
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: title, data, borderWidth: 1 }]
    },
    options: {
      indexAxis: 'y',                    // << horizontal: contagem no eixo X
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, title: { display: true, text: 'Ocorrências' } },
        y: { ticks: { autoSkip: false } }
      }
    }
  };
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas.getContext('2d'), cfg);
  return canvas._chart;
}

/* ========= Auth ========= */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  userEmailEl && (userEmailEl.textContent = `Olá, ${user.email}`);

  try {
    currentToken = await user.getIdToken(true);
  } catch (e) {
    console.error('Token error:', e);
    window.location.href = 'login.html';
    return;
  }

  // datas padrão
  const def = defaultPeriod();
  repStart && (repStart.value = def.start);
  repEnd   && (repEnd.value   = def.end);
  startInp && (startInp.value = def.start);
  endInp   && (endInp.value   = def.end);

  bindUI();

  // carrega tudo
  await loadAliases();
  await loadKpisAndCharts();
  await loadOperations(1, currentFilters);

  // cache completo p/ filtros/gráficos (fallback)
  try {
    allOpsCache = await fetchAllOps({});
    populateEmbarcadorFilter(allOpsCache);
    if (!offendersChart || !clientsChart) updateChartsFromOps(allOpsCache);
  } catch (e) {
    console.warn('Falha ao pré-carregar dataset completo:', e);
  }
});

/* ========= Bind UI ========= */
function bindUI(){
  $('#logoutButton')?.addEventListener('click', () => firebase.auth().signOut());
  navReportsBtn?.addEventListener('click', () => window.location.href = 'admin-reports.html');

  filterBtn?.addEventListener('click', () => {
    page = 1;
    currentFilters = collectFilters();
    loadKpisAndCharts();
    loadOperations(page, currentFilters);
  });

  clearBtn?.addEventListener('click', () => {
    embarcadorSel.value = '';
    bookingInp.value = '';
    containerInp.value = '';
    const def = defaultPeriod();
    startInp.value = def.start;
    endInp.value = def.end;
    page = 1;
    currentFilters = collectFilters();
    loadKpisAndCharts();
    loadOperations(page, currentFilters);
  });

  prevPageBtn?.addEventListener('click', () => {
    if (page > 1) { page--; loadOperations(page, currentFilters); }
  });
  nextPageBtn?.addEventListener('click', () => { page++; loadOperations(page, currentFilters); });

  btnExcelTop?.addEventListener('click', () => downloadExcel('/api/reports/top-ofensores.xlsx'));
  btnExcelAtrasos?.addEventListener('click', () => downloadExcel('/api/reports/atrasos.xlsx'));

  aliasSaveBtn?.addEventListener('click', saveAlias);
}

function collectFilters(){
  return {
    embarcador: embarcadorSel?.value || '',
    booking: bookingInp?.value || '',
    container: containerInp?.value || '',
    start: startInp?.value || '',
    end: endInp?.value || ''
  };
}

/* ========= Aliases ========= */
async function loadAliases(){
  try {
    const rows = await apiGet('/api/aliases');
    renderAliases(rows);
    aliasMsg.textContent = '';
  } catch (e) {
    console.error(e);
    renderAliases([]);
    aliasMsg.textContent = 'Erro ao carregar apelidos (verifique autenticação).';
  }
}

function renderAliases(rows){
  aliasesBody.innerHTML = '';
  if (!rows || !rows.length){
    aliasesBody.innerHTML = `<tr><td colspan="2" class="muted">Nenhum apelido cadastrado.</td></tr>`;
    return;
  }
  for (const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${safe(r.alias || r.nome_sujo)}</td>
      <td>${safe(r.master || r.nome_mestre || r.nome_principal)}</td>`;
    aliasesBody.appendChild(tr);
  }
}

async function saveAlias(){
  const alias  = (aliasInput.value || '').trim();
  const master = (masterInput.value || '').trim();
  if (!alias || !master){ aliasMsg.textContent = 'Preencha alias e mestre.'; return; }
  aliasMsg.textContent = 'Salvando...';
  try{
    await apiPost('/api/aliases', { alias, master });
    aliasMsg.textContent = 'Salvo.';
    aliasInput.value = ''; masterInput.value = '';
    loadAliases();
  }catch(e){
    console.error(e);
    aliasMsg.textContent = 'Falha ao salvar.';
  }
}

/* ========= KPIs & Gráficos ========= */
async function loadKpisAndCharts(){
  const f = collectFilters();
  try {
    const d = await apiGet('/api/dashboard/kpis', f);
    const k = d?.kpis || d;
    setKpis(k.total_operacoes ?? k.total, k.operacoes_on_time ?? k.onTime, k.operacoes_atrasadas ?? k.late);

    if (d?.grafico_ofensores && d?.grafico_clientes_atraso){
      offendersChart = drawHorizontalBar(
        ofChartCanvas,
        d.grafico_ofensores.labels || [],
        d.grafico_ofensores.data   || [],
        'Top 10 Ofensores'
      );
      clientsChart = drawHorizontalBar(
        clChartCanvas,
        d.grafico_clientes_atraso.labels || [],
        d.grafico_clientes_atraso.data   || [],
        'Top 10 Clientes'
      );
      return;
    }
  } catch (e) {
    console.warn('API KPIs indisponível, caindo para fallback pelos dados das operações:', e);
  }

  // Fallback: usa dataset para kpis e gráficos
  if (!allOpsCache.length) allOpsCache = await fetchAllOps(f);
  const { total, onTime, late } = aggregateKpis(allOpsCache);
  setKpis(total, onTime, late);
  updateChartsFromOps(allOpsCache);
}

function aggregateKpis(list){
  let total=0,on=0,late=0;
  for (const op of list){
    total++;
    const status = (op.status_operacao || op.status || '').toUpperCase();
    if (status.includes('ATRAS')) late++;
    else on++;
  }
  return { total, onTime:on, late };
}

function updateChartsFromOps(list){
  // Top 10 ofensores por justificativa_atraso
  const mapOf = new Map();
  const mapCl = new Map();
  for (const op of list){
    if (op.justificativa_atraso){
      const k = op.justificativa_atraso;
      mapOf.set(k, (mapOf.get(k)||0)+1);
    }
    if ((op.status_operacao||op.status||'').toUpperCase().includes('ATRAS') && (op.nome_embarcador||op.embarcador)){
      const k = op.nome_embarcador || op.embarcador;
      mapCl.set(k, (mapCl.get(k)||0)+1);
    }
  }
  const ofArr = [...mapOf.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const clArr = [...mapCl.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  offendersChart = drawHorizontalBar(ofChartCanvas, ofArr.map(x=>x[0]), ofArr.map(x=>x[1]), 'Top 10 Ofensores');
  clientsChart   = drawHorizontalBar(clChartCanvas,   clArr.map(x=>x[0]), clArr.map(x=>x[1]), 'Top 10 Clientes');
}

/* ========= Operações ========= */
async function loadOperations(p=1, filters={}){
  page = p;
  const q = {
    page,
    pageSize: PAGE_SIZE,
    embarcador: filters.embarcador,
    booking: filters.booking,
    container: filters.container,
    start: filters.start,
    end: filters.end
  };
  try{
    const payload = await apiGet('/api/operations', q);
    const list   = payload.items || payload.rows || payload.data || [];
    renderTable(list);
  }catch(e){
    console.error('Ops:', e);
    renderTable([]);
  }
}

function renderTable(items){
  tableBodyEl.innerHTML = '';
  if (!items.length){
    tableBodyEl.innerHTML = `<tr><td colspan="8" class="muted">Nenhuma operação encontrada.</td></tr>`;
    return;
  }

  for (const op of items){
    const tr = document.createElement('tr');
    tr.className = 'operation-row';
    tr.innerHTML = `
      <td>${safe(op.booking)}</td>
      <td>${safe(op.containers || op.container)}</td>
      <td>${safe(op.nome_embarcador || op.embarcador)}</td>
      <td>${safe(op.porto || op.porto_origem)}</td>
      <td>${fmt(op.previsao_inicio_atendimento || op.previsao_atendimento)}</td>
      <td>${fmt(op.dt_inicio_execucao)}</td>
      <td>${fmt(op.dt_fim_execucao)}</td>
      <td>${safe(op.status_operacao || op.status)}</td>
    `;
    // linha de detalhes solicitados
    const trDet = document.createElement('tr');
    const tdDet = document.createElement('td');
    tdDet.colSpan = 8;
    tdDet.innerHTML = `
      <div class="op-details">
        <b>Tipo de Programação:</b> ${safe(op.tipo_programacao)} •
        <b>Status:</b> ${safe(op.status_operacao || op.status)} •
        <b>Nº Programação:</b> ${safe(op.numero_programacao)}<br>
        <b>Motorista:</b> ${safe(op.motorista_nome)} —
        <b>CPF:</b> ${safe(op.motorista_cpf)}<br>
        <b>Placa Veículo:</b> ${safe(op.placa_veiculo)} •
        <b>Placa Carreta:</b> ${safe(op.placa_carreta)} •
        <b>Nº Cliente:</b> ${safe(op.numero_cliente)}
      </div>`;
    trDet.appendChild(tdDet);

    // toggle de expansão
    tr.addEventListener('click', () => {
      trDet.style.display = trDet.style.display === 'none' ? '' : 'none';
    });
    trDet.style.display = 'none';

    tableBodyEl.appendChild(tr);
    tableBodyEl.appendChild(trDet);
  }
}

/* ========= Excel ========= */
async function downloadExcel(path){
  try {
    const h = await authHeader();
    const url = `${API_BASE}${path}?start=${encodeURIComponent(repStart.value||'')}&end=${encodeURIComponent(repEnd.value||'')}`;
    const res = await fetch(url, { headers: h });
    if (!res.ok) throw new Error(await res.text());
    // baixa como blob
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = path.includes('top-ofensores') ? 'top-10.xlsx' : 'resumo-atrasos.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('Falha ao gerar Excel: ' + e.message);
  }
}

/* ========= Dataset completo para filtros/gráficos ========= */
async function fetchAllOps(filters){
  const out = [];
  let page = 1, keep = true;
  while (keep){
    const r = await apiGet('/api/operations', { page, pageSize: 500, ...filters });
    const arr = r.items || r.rows || r.data || [];
    out.push(...arr);
    const total = r.total ?? r.count ?? r.totalCount ?? out.length;
    keep = arr.length > 0 && out.length < total;
    page++;
    if (page > 30) break; // trava de segurança
  }
  return out;
}

function populateEmbarcadorFilter(list){
  const set = new Set();
  for (const op of list){
    const n = op.nome_embarcador || op.embarcador;
    if (n) set.add(n);
  }
  const cur = embarcadorSel.value;
  embarcadorSel.innerHTML = `<option value="">Todos Embarcadores</option>` +
    [...set].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(n=>`<option>${n}</option>`).join('');
  if (cur) embarcadorSel.value = cur;
}