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

  // ========= Classificação de atraso / on-time =========
  // Calcula a situação olhando valor numérico e HH:MM/ON TIME (quando existir)
  function computeLateFlag(op) {
    const s = (String(op.status_operacao || op.status || '')).toLowerCase();
    const atrasoStr = String(op.atraso_hhmm ?? op.tempo_atraso_hhmm ?? '').toUpperCase().trim();
    const atrasoNum = Number(op.tempo_atraso ?? op.atraso_minutos ?? 0);

    // 1) numérico manda
    if (!Number.isNaN(atrasoNum) && atrasoNum > 0) return { late: true, ontime: false };
    if (!Number.isNaN(atrasoNum) && atrasoNum <= 0) return { late: false, ontime: true };

    // 2) string do atraso
    if (atrasoStr && atrasoStr !== 'N/A' && atrasoStr !== 'ON TIME' && atrasoStr !== '00:00' && atrasoStr !== '0:00') {
      return { late: true, ontime: false };
    }
    if (atrasoStr === 'ON TIME' || atrasoStr === '00:00' || atrasoStr === '0:00') {
      return { late: false, ontime: true };
    }

    // 3) heurística pelo status textual (fallback)
    const isLate = /atras/.test(s);
    const isOn   = /(on ?time|no prazo|pontual|sem atraso|programado)/.test(s);
    return { late: isLate, ontime: !isLate && isOn };
  }
  function isLateStatus(op)   { return computeLateFlag(op).late;   }
  function isOnTimeStatus(op) { return computeLateFlag(op).ontime; }

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

    // se ainda não temos dataset completo, baixa em background p/ filtros e gráficos
    if (!currentAllOps.length) currentAllOps = await fetchAllOps({});
    populateEmbarcadorFilter(currentAllOps);
    updateChartsFromOps(currentAllOps);
  });

  // ========= KPIs (API + Fallback) =========
  async function fetchKpisWithFallback(){
    try {
      const d = await apiGet('/api/dashboard/kpis');
      // aceita os 2 formatos: {kpis:{...}} OU flat
      const k = d?.kpis || d;
      setKpis(k.total_operacoes, k.operacoes_on_time, k.operacoes_atrasadas);

      // se o back já mandou dados p/ gráficos, usa direto
      if (d?.grafico_ofensores && d?.grafico_clientes_atraso) {
        const go = d.grafico_ofensores, gc = d.grafico_clientes_atraso;
        drawBar('ofensoresChart', 'Top 10 Ofensores', go.labels || [], go.data || [], 'ofensores');
        drawBar('clientesChart',  'Top 10 Clientes',  gc.labels || [], gc.data || [], 'clientes');
        return;
      }

      // caso venha só os KPIs, faz o fallback para gráficos
      if (!currentAllOps.length) currentAllOps = await fetchAllOps({});
      updateChartsFromOps(currentAllOps);
    } catch (e) {
      // Fallback total: computa tudo pelo dataset
      currentAllOps = await fetchAllOps({});
      const { total, onTime, late } = aggregateKpis(currentAllOps);
      setKpis(total, onTime, late);
      updateChartsFromOps(currentAllOps);
    }
  }
  function setKpis(total, onTime, late){
    const pct = total ? Math.round((late/total)*10000)/100 : 0;
    kpiTotalValue  && (kpiTotalValue.textContent  = String(total ?? 0));
    kpiOntimeValue && (kpiOntimeValue.textContent = String(onTime ?? 0));
    kpiLateValue   && (kpiLateValue.textContent   = String(late ?? 0));
    kpiPctValue    && (kpiPctValue.textContent    = `${pct}%`);
  }
  function aggregateKpis(items){
    let total=0,onTime=0,late=0;
    for(const op of items){
      total++;
      if (isLateStatus(op)) late++;
      else if (isOnTimeStatus(op)) onTime++;
    }
    return { total,onTime,late };
  }

  // ========= Operações =========
  async function fetchOps(page=1, filters={}){
    currentPage = page;
    currentFilters = {
      booking: (filters.booking||'').trim(),
      data_previsao: (filters.data_previsao||'').trim(),
      embarcador: (filters.embarcador||'').trim()
    };
    // usa "limit" (o back espera "limit")
    const q = qs({ page, limit: PAGE_SIZE, ...currentFilters });
    try{
      const payload = await apiGet(`/api/operations?${q}`);
      const list   = payload.items || payload.rows || payload.data || [];
      list.forEach(applyAliasToOp);
      renderTable(list);

      const total  = (payload.total ?? payload.count ?? payload.totalCount ?? payload?.pagination?.totalItems ?? 0);
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
      const q = qs({ page, limit: BULK_SIZE, ...filters });
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
      const booking    = firstOf(op, ['booking'], 'N/A');
      const containers = firstOf(op, ['containers','container','conteiner'], 'N/A');
      const embarc     = firstOf(op, ['nome_embarcador','embarcador'], 'N/A');
      const porto      = firstOf(op, ['porto','porto_origem'], 'N/A');
      const prev       = firstOf(op, ['previsao_inicio_atendimento'], null);
      const iniExec    = firstOf(op, ['dt_inicio_execucao'], null);
      const fimExec    = firstOf(op, ['dt_fim_execucao'], null);
      const atraso     = firstOf(op, ['atraso_hhmm','atraso','tempo_atraso','tempo_atraso_hhmm'], 'N/A');
      const motivo     = firstOf(op, ['motivo_atraso','motivo_do_atraso','motivo'], 'N/A');
      const status     = firstOf(op, ['status_operacao','status'], 'N/A');

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

      // Detalhe com campos solicitados
      const tipoOp       = firstOf(op, ['tipo_operacao','tipo','operacao_tipo'], 'N/A');
      const transp       = firstOf(op, ['transportadora','transportadora_nome','carrier'], 'N/A');
      const prog         = firstOf(op, ['numero_programacao','programacao','num_programacao'], 'N/A');
      const motNome      = firstOf(op, ['motorista_nome','nome_motorista'], 'N/A');
      const motCpf       = firstOf(op, ['motorista_cpf','cpf_motorista'], 'N/A');
      const placaVeic    = firstOf(op, ['placa_veiculo','veiculo_placa','placa_cavalo'], 'N/A');
      const placaCarreta = firstOf(op, ['placa_carreta','carreta_placa','placa_reboque'], 'N/A');

      const det = document.createElement('tr');
      det.className = 'details-row';
      det.innerHTML = `
        <td colspan="9" class="details-content">
          <div class="details-wrapper">
            <span><strong>Tipo de Operação:</strong> ${safe(tipoOp)}</span>
            <span><strong>Transportadora:</strong> ${safe(transp)}</span>
            <span><strong>Nº Programação:</strong> ${safe(prog)}</span>
            <span><strong>Motorista:</strong> ${safe(motNome)}</span>
            <span><strong>CPF do Motorista:</strong> ${safe(motCpf)}</span>
            <span><strong>Placa Veículo:</strong> ${safe(placaVeic)}</span>
            <span><strong>Placa Carreta:</strong> ${safe(placaCarreta)}</span>
            <span><strong>Status:</strong> ${safe(status)}</span>
            <span><strong>Previsão Atendimento:</strong> ${fmt(prev)}</span>
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
      if (next && next.classList.contains('details-row')) next.classList.toggle('visible');
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
    navReportsBtn?.addEventListener('click', ()=> window.location.href='admin-reports.html');
  }

  // ========= Gráficos =========
  function refreshChartsTheme(){
    if (CHARTS.ofensores) CHARTS.ofensores.update();
    if (CHARTS.clientes)  CHARTS.clientes.update();
  }
  function updateChartsFromOps(items){
    // Top 10 Ofensores (motivos) – só quem está atrasado
    const mapMotivo = new Map();
    for (const op of items) {
      if (!isLateStatus(op)) continue;
      const m = firstOf(op, ['motivo_atraso','motivo_do_atraso','motivo'], 'Sem motivo');
      mapMotivo.set(m, (mapMotivo.get(m)||0)+1);
    }
    const motivos = [...mapMotivo.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    drawBar('ofensoresChart','Top 10 Ofensores', motivos.map(x=>x[0]), motivos.map(x=>x[1]), 'ofensores');

    // Top 10 Clientes com atraso
    const mapCli = new Map();
    for (const op of items) {
      if (!isLateStatus(op)) continue;
      const c = firstOf(op, ['nome_embarcador','embarcador'],'Sem cliente');
      mapCli.set(c, (mapCli.get(c)||0)+1);
    }
    const clientes = [...mapCli.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    drawBar('clientesChart','Top 10 Clientes', clientes.map(x=>x[0]), clientes.map(x=>x[1]), 'clientes');
  }
  function drawBar(canvasId, label, labels, data, which){
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
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

  // ========= KPI Clicks (modal) =========
  function bindKpiClicks(){
    const totalCard = document.getElementById('kpi-total');
    const onCard    = document.getElementById('kpi-ontime');
    const lateCard  = document.getElementById('kpi-atrasadas');
    const map = [
      [totalCard,'total'],
      [onCard,'on_time'],
      [lateCard,'atrasadas'],
    ];
    map.forEach(([el,mode])=>{
      if (!el) return;
      el.style.cursor='pointer';
      el.addEventListener('click', ()=> openFilteredModal(mode));
    });
  }
  function openFilteredModal(mode){
    const titles = { total:'Todas as operações', on_time:'Operações On Time', atrasadas:'Operações Atrasadas' };
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;';
    const modal = document.createElement('div');
    modal.style.cssText='position:fixed;inset:5%;background:#fff;color:#111;border-radius:14px;padding:16px;z-index:9999;overflow:auto;';
    if (document.body.classList.contains('dark-mode')) { modal.style.background='#0b1220'; modal.style.color='#e5e7eb'; }
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0">${titles[mode]||'Operações'}</h3>
        <button id="closeModal" class="btn">Fechar</button>
      </div>
      <div id="modalContent">Carregando…</div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    document.getElementById('closeModal').onclick = ()=>{ modal.remove(); overlay.remove(); };

    (async()=>{
      try{
        const all = currentAllOps.length ? currentAllOps : await fetchAllOps(currentFilters);
        const sub = (mode==='total') ? all : all.filter(op => {
          if (mode==='atrasadas') return isLateStatus(op);
          if (mode==='on_time')   return isOnTimeStatus(op);
          return true;
        });
        document.getElementById('modalContent').innerHTML = renderMiniTable(sub);
      }catch{
        document.getElementById('modalContent').textContent='Falha ao carregar operações.';
      }
    })();
  }
  function renderMiniTable(items){
    if (!items.length) return '<p>Nenhuma operação.</p>';
    const rows = items.slice(0,1000).map(op=>`
      <tr>
        <td>${safe(firstOf(op,['booking'],'N/A'))}</td>
        <td>${safe(firstOf(op,['containers','container','conteiner'],'N/A'))}</td>
        <td>${safe(firstOf(op,['nome_embarcador','embarcador'],'N/A'))}</td>
        <td>${fmt(firstOf(op,['previsao_inicio_atendimento'],null))}</td>
        <td>${fmt(firstOf(op,['dt_inicio_execucao'],null))}</td>
        <td>${fmt(firstOf(op,['dt_fim_execucao'],null))}</td>
        <td>${safe(firstOf(op,['status_operacao','status'],'N/A'))}</td>
      </tr>`).join('');
    return `
      <div class="table-wrapper">
        <table class="operations-table">
          <thead><tr>
            <th>Booking</th><th>Contêiner</th><th>Embarcador</th>
            <th>Prev. Atendimento</th><th>Início Execução</th><th>Fim Execução</th><th>Status</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:8px" class="muted">Exibindo até 1000 registros.</p>
      </div>`;
  }

  // ========= Gerenciador de Apelidos =========
  async function loadAliases(){
    try{
      const list = await apiGet('/api/aliases');
      aliasMap = {};
      for (const a of list) aliasMap[norm(a.alias)] = a.master;
    }catch{
      try { aliasMap = JSON.parse(localStorage.getItem('aliasMap')||'{}'); } catch { aliasMap = {}; }
    }
    renderAliasesTable();
  }
  async function saveAlias(alias, master){
    try{
      await fetch(`${API}/api/aliases`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', ...(currentToken?{Authorization:`Bearer ${currentToken}`}:{}) },
        body: JSON.stringify({ alias, master })
      });
    }catch{
      aliasMap[norm(alias)] = master;
      localStorage.setItem('aliasMap', JSON.stringify(aliasMap));
    }
    await fetchOps(currentPage, currentFilters);
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${aliasNorm}</td>
        <td>${master}</td>
        <td><input type="text" class="newMaster" placeholder="Novo mestre (ex.: AMBEV)" /></td>
        <td><button class="button-reassign">Reassociar</button></td>`;
      tr.querySelector('.button-reassign').addEventListener('click', () => {
        const newMaster = tr.querySelector('.newMaster').value.trim();
        if (!newMaster) return alert('Informe o novo mestre.');
        saveAlias(aliasNorm, newMaster);
      });
      aliasesTableBody.appendChild(tr);
    }
  }

  // Atalho: abre o chat (se mantiver o Dialogflow no admin)
  window.openAssistant = () => {
    const df = document.querySelector('df-messenger');
    if (df) df.setAttribute('expanded','true');
  };
})();