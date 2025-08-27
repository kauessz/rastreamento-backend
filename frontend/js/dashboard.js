(() => {
  // ========= Base/API =========
  window.API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
  const API = window.API_BASE_URL;
  const PAGE_SIZE = 10;   // tabela principal
  const BULK_SIZE = 1000; // carregamento em massa (fallback KPIs / modal)
  let CHARTS = { ofensores: null, clientes: null };

  // ========= Tema =========
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
    // ajusta gráficos ao tema
    refreshChartsTheme();
  });

  // ========= Elementos =========
  const userEmailEl      = document.getElementById('userEmail');
  const navReportsBtn    = document.getElementById('navReports');

  const kpiTotalValue    = document.querySelector('#kpi-total .kpi-value');
  const kpiOntimeValue   = document.querySelector('#kpi-ontime .kpi-value');
  const kpiLateValue     = document.querySelector('#kpi-atrasadas .kpi-value');
  const kpiPctValue      = document.querySelector('#kpi-percentual .kpi-value');

  const embarcadorFilter = document.getElementById('embarcadorFilter');
  const bookingFilter    = document.getElementById('bookingFilter');
  const dataPrevFilter   = document.getElementById('dataPrevisaoFilter');
  const filterBtn        = document.getElementById('filterButton');
  const clearBtn         = document.getElementById('clearFilterButton');

  const tableBodyEl = document.querySelector('#operationsTable tbody') ||
                      document.querySelector('table tbody');
  const paginationEl = document.getElementById('paginationControls');

  const repStart = document.getElementById('repStart');
  const repEnd   = document.getElementById('repEnd');
  const btnTop   = document.getElementById('btnExcelTop');
  const btnAtr   = document.getElementById('btnExcelAtrasos');

  // Gerenciador de Apelidos
  const aliasesTableBody = document.querySelector('#aliasesTable tbody');

  // ========= Estado =========
  let currentUser  = null;
  let currentToken = null;
  let currentPage  = 1;
  let currentFilters = { booking: '', data_previsao: '', embarcador: '' };
  let currentAllOps  = [];  // cache para gráficos/KPI fallback
  let aliasMap = {};        // { "ambev s.a.": "AMBEV", "ambev": "AMBEV" }

  // ========= Utils =========
  const fmt = (iso) => { try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; } };
  const safe = (v) => (v==null || v==='') ? 'N/A' : String(v);
  const qs = (o) => { const p=new URLSearchParams(); for (const [k,v] of Object.entries(o)) if(v!=null&&v!=='') p.append(k,v); return p.toString(); };
  const todayISO = () => (new Date()).toISOString().slice(0,10);
  const defaultPeriod = () => { const end=todayISO(); const s=new Date(Date.now()-30*864e5).toISOString().slice(0,10); return {start:s,end}; };

  const norm = (s) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const firstOf = (obj, keys, fallback='N/A') => {
    for (const k of keys) if (obj && obj[k]!=null && obj[k]!=='') return obj[k];
    return fallback;
  };

  async function apiGet(path, withAuth=true){
    const headers={'Content-Type':'application/json'};
    if(withAuth && currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const r = await fetch(`${API}${path}`, {headers});
    if(!r.ok) throw new Error(await r.text().catch(()=>`HTTP ${r.status}`));
    return r.json();
  }
  async function apiFetchBlob(path, params) {
    const q = params ? `?${new URLSearchParams(params).toString()}` : '';
    const resp = await fetch(`${API}${path}${q}`, {
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {}
    });
    if(!resp.ok) throw new Error(await resp.text().catch(()=>`HTTP ${resp.status}`));
    return resp.blob();
  }
  async function downloadAuth(path, params, filename) {
    const blob = await apiFetchBlob(path, params);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function periodFromUI() {
    const s = repStart?.value, e = repEnd?.value;
    if (!s || !e) { const d=defaultPeriod(); return d; }
    return { start: s, end: e };
  }

  // ========= Auth =========
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    currentUser = user;
    userEmailEl && (userEmailEl.textContent = `Olá, ${user.email}`);

    try {
      currentToken = await user.getIdToken(true);
    } catch (e) {
      console.error('Token error:', e);
      window.location.href='login.html';
      return;
    }

    // datas padrão
    const def = defaultPeriod();
    repStart && (repStart.value = def.start);
    repEnd   && (repEnd.value   = def.end);

    // navegação p/ relatórios
    navReportsBtn?.addEventListener('click', () => window.location.href = 'admin-reports.html');

    bindAdminReportButtons();
    bindKpiClicks();
    bindFilters();
    bindTableExpand();

    await loadAliases();
    await fetchKpisWithFallback();
    await fetchOps(1, currentFilters);

    // carrega embarcadores no filtro a partir do dataset
    populateEmbarcadorFilter(currentAllOps);
    // gráficos iniciais
    updateChartsFromOps(currentAllOps);
  });

  // ========= KPIs (API + Fallback) =========
  async function fetchKpisWithFallback(){
    try {
      const d = await apiGet('/api/dashboard/kpis');
      setKpis(d.total_operacoes, d.operacoes_on_time, d.operacoes_atrasadas);
    } catch (e) {
      // Fallback: computa a partir de todas as operações
      currentAllOps = await fetchAllOps({});
      const { total, onTime, late } = aggregateKpis(currentAllOps);
      setKpis(total, onTime, late);
    }
  }
  function setKpis(total, onTime, late){
    const pct = total ? Math.round((late/total)*10000)/100 : 0;
    kpiTotalValue  && (kpiTotalValue.textContent  = String(total));
    kpiOntimeValue && (kpiOntimeValue.textContent = String(onTime));
    kpiLateValue   && (kpiLateValue.textContent   = String(late));
    kpiPctValue    && (kpiPctValue.textContent    = `${pct}%`);
  }
  function isLateStatus(s){ return /atras/.test((s||'').toLowerCase()); }
  function isOnTimeStatus(s){ return /(on ?time|no prazo|pontual|sem atraso)/.test((s||'').toLowerCase()); }
  function aggregateKpis(items){
    let total=0, onTime=0, late=0;
    for(const op of items){
      total++;
      const status = firstOf(op, ['status_operacao','status'], '');
      if (isLateStatus(status)) late++; else if (isOnTimeStatus(status)) onTime++;
    }
    return { total, onTime, late };
  }

  // ========= Operações =========
  async function fetchOps(page=1, filters={}){
    currentPage = page;
    currentFilters = {
      booking: (filters.booking||'').trim(),
      data_previsao: (filters.data_previsao||'').trim(),
      embarcador: (filters.embarcador||'').trim()
    };
    const q = qs({ page, pageSize: PAGE_SIZE, ...currentFilters });
    try{
      const payload = await apiGet(`/api/operations?${q}`);
      const list   = payload.items || payload.rows || payload.data || [];
      // aplica apelidos no embarcador
      list.forEach(applyAliasToOp);
      renderTable(list);
      const total  = (payload.total ?? payload.count ?? payload.totalCount ?? 0);
      renderPagination(total, page, PAGE_SIZE);
    }catch(e){
      console.error('Ops:', e);
      renderTable([]); renderPagination(0,1,PAGE_SIZE);
    }
  }

  async function fetchAllOps(filters={}){
    const list = [];
    let page = 1;
    for(;;){
      const q = qs({ page, pageSize: BULK_SIZE, ...filters });
      try{
        const payload = await apiGet(`/api/operations?${q}`);
        const chunk = payload.items || payload.rows || payload.data || [];
        chunk.forEach(applyAliasToOp);
        list.push(...chunk);
        if (chunk.length < BULK_SIZE) break;
        page++;
      }catch{ break; }
    }
    currentAllOps = list;
    return list;
  }

  function applyAliasToOp(op){
    const raw = firstOf(op, ['nome_embarcador','embarcador'], 'N/A');
    const n = norm(raw);
    if (aliasMap[n]) op.nome_embarcador = aliasMap[n];
  }

  // ========= Render Tabela + Detalhe =========
  function renderTable(items){
    if(!tableBodyEl) return;
    tableBodyEl.innerHTML='';
    if(!items.length){
      const tr=document.createElement('tr'); const td=document.createElement('td');
      td.colSpan=9; td.textContent='Nenhuma operação encontrada.'; tr.appendChild(td); tableBodyEl.appendChild(tr); return;
    }
    for(const op of items){
      // campos com mapeamento tolerante
      const booking   = firstOf(op, ['booking'], 'N/A');
      const containers= firstOf(op, ['containers','container','conteiner'], 'N/A');
      const embarc    = firstOf(op, ['nome_embarcador','embarcador'], 'N/A');
      const porto     = firstOf(op, ['porto','porto_origem'], 'N/A');
      const prev      = firstOf(op, ['previsao_inicio_atendimento'], null);
      const iniExec   = firstOf(op, ['dt_inicio_execucao'], null);
      const fimExec   = firstOf(op, ['dt_fim_execucao'], null);
      const atraso    = firstOf(op, ['atraso_hhmm','atraso','tempo_atraso','tempo_atraso_hhmm'], 'N/A');
      const motivo    = firstOf(op, ['motivo_atraso','motivo_do_atraso','motivo'], 'N/A');
      const status    = firstOf(op, ['status_operacao','status'], 'N/A');

      // linha principal
      const tr = document.createElement('tr');
      tr.className = 'main-row';
      tr.innerHTML = `
        <td>${safe(booking)}</td>
        <td>${safe(containers)}</td>
        <td>${safe(embarc)}</td>
        <td>${safe(porto)}</td>
        <td>${fmt(prev)}</td>
        <td>${fmt(iniExec)}</td>
        <td>${fmt(fimExec)}</td>
        <td>${safe(atraso)}</td>
        <td>${safe(motivo)}</td>
      `;
      tableBodyEl.appendChild(tr);

      // linha de detalhes (expansível)
      const det = document.createElement('tr');
      det.className = 'details-row';
      det.innerHTML = `
        <td colspan="9" class="details-content">
          <div class="details-wrapper">
            <span><strong>Status:</strong> ${safe(status)}</span>
            <span><strong>Booking:</strong> ${safe(booking)}</span>
            <span><strong>Contêiner:</strong> ${safe(containers)}</span>
            <span><strong>Embarcador:</strong> ${safe(embarc)}</span>
            <span><strong>Porto:</strong> ${safe(porto)}</span>
            <span><strong>Previsão de Atendimento:</strong> ${fmt(prev)}</span>
            <span><strong>Início Execução:</strong> ${fmt(iniExec)}</span>
            <span><strong>Fim Execução:</strong> ${fmt(fimExec)}</span>
            <span><strong>Atraso:</strong> ${safe(atraso)}</span>
            <span><strong>Motivo do Atraso:</strong> ${safe(motivo)}</span>
          </div>
        </td>`;
      tableBodyEl.appendChild(det);
    }
  }

  function bindTableExpand(){
    tableBodyEl?.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.main-row');
      if (!tr) return;
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('details-row')) {
        next.classList.toggle('visible'); // CSS já tem .details-row/.visible
      }
    });
  }

  function renderPagination(total, page, pageSize){
    if(!paginationEl) return;
    const totalPages = Math.max(1, Math.ceil(total/pageSize));
    const prev=Math.max(1,page-1), next=Math.min(totalPages,page+1);
    paginationEl.innerHTML = `
      <div class="pagination">
        <button ${page===1?'disabled':''} data-goto="${prev}">Anterior</button>
        <span>Página ${page} de ${totalPages}</span>
        <button ${page===totalPages?'disabled':''} data-goto="${next}">Próxima</button>
      </div>`;
  }
  paginationEl?.addEventListener('click',(e)=>{
    const b=e.target.closest('button[data-goto]'); if(!b) return;
    fetchOps(Number(b.dataset.goto||'1'), currentFilters);
  });

  // ========= Filtros =========
  function bindFilters(){
    filterBtn?.addEventListener('click', ()=>{
      fetchOps(1, {
        booking: bookingFilter?.value||'',
        data_previsao: dataPrevFilter?.value||'',
        embarcador: embarcadorFilter?.value||''
      });
    });
    clearBtn?.addEventListener('click', ()=>{
      if(bookingFilter) bookingFilter.value='';
      if(dataPrevFilter) dataPrevFilter.value='';
      if(embarcadorFilter) embarcadorFilter.value='';
      fetchOps(1, { booking:'', data_previsao:'', embarcador:'' });
    });
  }
  function populateEmbarcadorFilter(items){
    if (!embarcadorFilter) return;
    const set = new Set(items.map(op => firstOf(op,['nome_embarcador','embarcador'],'N/A')));
    embarcadorFilter.innerHTML = `<option value="">Todos Embarcadores</option>` + 
      [...set].filter(Boolean).sort().map(n=>`<option value="${n}">${n}</option>`).join('');
  }

  // ========= Relatórios (admin) =========
  function bindAdminReportButtons(){
    if (btnTop) btnTop.addEventListener('click', async ()=>{
      try {
        const {start,end}=periodFromUI();
        await downloadAuth('/api/reports/top-ofensores.xlsx', {start,end,companyId:0},
          `top_ofensores_${start}_a_${end}.xlsx`);
      } catch (e) { console.error(e); alert('Falha ao gerar Excel de Top 10 Ofensores.'); }
    });
    if (btnAtr) btnAtr.addEventListener('click', async ()=>{
      try {
        const {start,end}=periodFromUI();
        await downloadAuth('/api/reports/atrasos.xlsx', {start,end,companyId:0},
          `resumo_atrasos_${start}_a_${end}.xlsx`);
      } catch (e) { console.error(e); alert('Falha ao gerar Excel de Atrasos.'); }
    });
  }

  // ========= Gráficos =========
  function refreshChartsTheme(){
    // apenas força redraw para cores do tema (texto/eixos)
    if (CHARTS.ofensores) CHARTS.ofensores.update();
    if (CHARTS.clientes) CHARTS.clientes.update();
  }
  function updateChartsFromOps(items){
    // Top motivos de atraso
    const motivoKey = (op) => firstOf(op, ['motivo_atraso','motivo_do_atraso','motivo'], 'Sem motivo');
    const mapMotivo = new Map();
    for (const op of items) {
      const s = firstOf(op,['status_operacao','status'],'');
      if (!isLateStatus(s)) continue;
      const m = motivoKey(op);
      mapMotivo.set(m, (mapMotivo.get(m)||0)+1);
    }
    const motivos = [...mapMotivo.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    drawBar('ofensoresChart', 'Top 10 Ofensores', motivos.map(x=>x[0]), motivos.map(x=>x[1]), 'ofensores');

    // Top clientes com atraso
    const mapCli = new Map();
    for (const op of items) {
      const s = firstOf(op,['status_operacao','status'],'');
      if (!isLateStatus(s)) continue;
      const c = firstOf(op, ['nome_embarcador','embarcador'],'Sem cliente');
      mapCli.set(c, (mapCli.get(c)||0)+1);
    }
    const clientes = [...mapCli.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    drawBar('clientesChart', 'Top 10 Clientes', clientes.map(x=>x[0]), clientes.map(x=>x[1]), 'clientes');
  }
  function drawBar(canvasId, label, labels, data, which){
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const cfg = {
      type: 'bar',
      data: { labels, datasets: [{ label, data }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: body.classList.contains('dark-mode') ? '#e5e7eb' : '#111827' }},
          y: { ticks: { color: body.classList.contains('dark-mode') ? '#e5e7eb' : '#111827' }}
        }
      }
    };
    if (which==='ofensores') { if (CHARTS.ofensores) CHARTS.ofensores.destroy(); CHARTS.ofensores = new Chart(ctx, cfg); }
    else { if (CHARTS.clientes) CHARTS.clientes.destroy(); CHARTS.clientes = new Chart(ctx, cfg); }
  }

  // ========= Gerenciador de Apelidos =========
  async function loadAliases(){
    // tenta do backend
    try{
      const list = await apiGet('/api/aliases');
      aliasMap = {};
      for (const a of list) aliasMap[norm(a.alias)] = a.master;
    }catch{
      // fallback localStorage
      try { aliasMap = JSON.parse(localStorage.getItem('aliasMap')||'{}'); } catch { aliasMap = {}; }
    }
    renderAliasesTable();
  }
  async function saveAlias(alias, master){
    const payload = { alias, master };
    try{
      await fetch(`${API}/api/aliases`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', ...(currentToken?{Authorization:`Bearer ${currentToken}`}:{}) },
        body: JSON.stringify(payload)
      });
    }catch{
      // fallback local
      aliasMap[norm(alias)] = master;
      localStorage.setItem('aliasMap', JSON.stringify(aliasMap));
    }
    await fetchOps(currentPage, currentFilters); // re-render com alias aplicado
    renderAliasesTable();
  }
  function renderAliasesTable(){
    if (!aliasesTableBody) return;
    aliasesTableBody.innerHTML = '';
    const rows = Object.entries(aliasMap);
    if (!rows.length){
      aliasesTableBody.innerHTML = `<tr><td colspan="4">Nenhum apelido cadastrado.</td></tr>`;
      return;
    }
    for (const [aliasNorm, master] of rows){
      const alias = aliasNorm; // já normalizado
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${alias}</td>
        <td>${master}</td>
        <td><input type="text" class="newMaster" placeholder="Novo mestre (ex.: AMBEV)" /></td>
        <td><button class="button-reassign">Reassociar</button></td>`;
      const btn = tr.querySelector('.button-reassign');
      btn.addEventListener('click', () => {
        const newMaster = tr.querySelector('.newMaster').value.trim();
        if (!newMaster) return alert('Informe o novo mestre.');
        saveAlias(alias, newMaster);
      });
      aliasesTableBody.appendChild(tr);
    }
  }

  // Assistente (atalho) – se mantiver o Dialogflow no admin
  window.openAssistant = () => {
    const df = document.querySelector('df-messenger');
    if (df) df.setAttribute('expanded','true');
  };

})();