(() => {
  // ========= Base/API =========
  window.API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
  const API = window.API_BASE_URL;
  const PAGE_SIZE = 10;              // página “normal”
  const BULK_SIZE = 1000;            // para buscar “tudo” ao abrir modal filtrado

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
  });

  // ========= Elementos =========
  const userEmailEl      = document.getElementById('userEmail');
  const kpiTotalValue    = document.querySelector('#kpi-total .kpi-value');
  const kpiOntimeValue   = document.querySelector('#kpi-ontime .kpi-value');
  const kpiLateValue     = document.querySelector('#kpi-atrasadas .kpi-value');
  const kpiPctValue      = document.querySelector('#kpi-percentual .kpi-value');

  const bookingFilter    = document.getElementById('bookingFilter');
  const dataPrevFilter   = document.getElementById('dataPrevisaoFilter');
  const filterBtn        = document.getElementById('filterButton');
  const clearBtn         = document.getElementById('clearFilterButton');

  const tableBodyEl = document.querySelector('#clientOperationsTable tbody') ||
                      document.querySelector('#operationsTable tbody') ||
                      document.querySelector('table tbody');
  const paginationEl = document.getElementById('paginationControls') ||
                       document.getElementById('pagination');

  // Barra de relatórios (admin)
  const repStart = document.getElementById('repStart');
  const repEnd   = document.getElementById('repEnd');
  const btnTop   = document.getElementById('btnExcelTop');
  const btnAtr   = document.getElementById('btnExcelAtrasos');

  // ========= Estado =========
  let currentUser  = null;
  let currentToken = null;
  let currentPage  = 1;
  let currentFilters = { booking: '', data_previsao: '' };
  window.CLIENT_COMPANY_ID = window.CLIENT_COMPANY_ID || 0;  // admin = 0 (todas)
  window.AUTH_EMAIL        = window.AUTH_EMAIL || '';

  // ========= Utils =========
  const fmt   = (iso) => { try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; } };
  const safe  = (v) => (v==null || v==='') ? 'N/A' : String(v);
  const qs    = (o) => { const p=new URLSearchParams(); for (const [k,v] of Object.entries(o)) if(v!=null&&v!=='') p.append(k,v); return p.toString(); };
  const todayISO = () => (new Date()).toISOString().slice(0,10);
  const defaultPeriod = () => { const end=todayISO(); const s=new Date(Date.now()-30*864e5).toISOString().slice(0,10); return {start:s,end}; };

  async function apiGet(path, withAuth=true){
    const headers={'Content-Type':'application/json'};
    if(withAuth && currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const r = await fetch(`${API}${path}`, {headers});
    if(!r.ok) throw new Error(await r.text()||`HTTP ${r.status}`);
    return r.json();
  }

  async function downloadAuth(path, params, filename) {
    if (!currentToken) throw new Error('Sem token');
    const q = new URLSearchParams(params || {}).toString();
    const resp = await fetch(`${API}${path}?${q}`, {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    if (!resp.ok) throw new Error(await resp.text().catch(()=>`HTTP ${resp.status}`));
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function getAdminPeriod() {
    const s = repStart?.value, e = repEnd?.value;
    if (!s || !e) return defaultPeriod();
    return { start: s, end: e };
  }

  // ========= Auth =========
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    currentUser = user;
    userEmailEl && (userEmailEl.textContent = `Olá, ${user.email}`);
    window.AUTH_EMAIL = user.email;

    try {
      currentToken = await user.getIdToken(true);
    } catch (e) {
      console.error('Token error:', e);
      window.location.href='login.html';
      return;
    }

    await resolveClientCompanyId();

    // datas padrão na barra de relatórios
    const def = defaultPeriod();
    repStart && (repStart.value = def.start);
    repEnd   && (repEnd.value   = def.end);

    bindAdminReportButtons();
    bindKpiClicks();

    await fetchKpis();
    await fetchOps(1, currentFilters);
  });

  async function resolveClientCompanyId(){
    if (Number(window.CLIENT_COMPANY_ID) > 0) return; // já definido
    try {
      const profile = await apiGet('/api/client/profile'); // admin: retorna algo padrão
      if (profile && Number(profile.embarcador_id)>0){
        window.CLIENT_COMPANY_ID = Number(profile.embarcador_id);
        if (!window.AUTH_EMAIL && profile.email) window.AUTH_EMAIL = profile.email;
      } else {
        window.CLIENT_COMPANY_ID = 0; // admin = todas
      }
    } catch(e){ window.CLIENT_COMPANY_ID = 0; }
  }

  // ========= KPIs =========
  async function fetchKpis(){
    try {
      const d = await apiGet('/api/client/kpis');
      kpiTotalValue  && (kpiTotalValue.textContent  = safe(d.total_operacoes));
      kpiOntimeValue && (kpiOntimeValue.textContent = safe(d.operacoes_on_time));
      kpiLateValue   && (kpiLateValue.textContent   = safe(d.operacoes_atrasadas));
      kpiPctValue    && (kpiPctValue.textContent    = (d.percentual_atraso!=null?`${d.percentual_atraso}%`:'0%'));
    } catch(e){ console.error('KPIs:', e); }
  }

  // ========= Tabela principal =========
  async function fetchOps(page=1, filters={}){
    currentPage = page;
    currentFilters = {
      booking: (filters.booking||'').trim(),
      data_previsao: (filters.data_previsao||'').trim()
    };
    const q = qs({ page, pageSize: PAGE_SIZE, ...currentFilters });
    try{
      const payload = await apiGet(`/api/client/operations?${q}`);
      const list   = payload.items || payload.rows || payload.data || [];
      const total  = (payload.total ?? payload.count ?? payload.totalCount ?? 0);
      renderTable(list);
      renderPagination(total, page, PAGE_SIZE);
    }catch(e){
      console.error('Ops:', e);
      renderTable([]); renderPagination(0,1,PAGE_SIZE);
    }
  }

  function renderTable(items){
    if(!tableBodyEl) return;
    tableBodyEl.innerHTML='';
    if(!items.length){
      const tr=document.createElement('tr'); const td=document.createElement('td');
      td.colSpan=8; td.textContent='Nenhuma operação encontrada.'; tr.appendChild(td); tableBodyEl.appendChild(tr); return;
    }
    items.forEach(op=>{
      const tr=document.createElement('tr'); tr.className='operation-row';
      [
        safe(op.booking),
        safe(op.containers),
        safe(op.nome_embarcador || op.embarcador || 'N/A'),
        safe(op.porto || op.porto_origem || 'N/A'),
        fmt(op.previsao_inicio_atendimento),
        fmt(op.dt_inicio_execucao),
        fmt(op.dt_fim_execucao),
        safe(op.status_operacao || op.status || 'N/A')
      ].forEach(t=>{const td=document.createElement('td'); td.textContent=t; tr.appendChild(td);});
      tableBodyEl.appendChild(tr);
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

  // Filtros simples
  filterBtn?.addEventListener('click', ()=>{
    fetchOps(1, { booking: bookingFilter?.value||'', data_previsao: dataPrevFilter?.value||'' });
  });
  clearBtn?.addEventListener('click', ()=>{
    if(bookingFilter) bookingFilter.value='';
    if(dataPrevFilter) dataPrevFilter.value='';
    fetchOps(1, { booking:'', data_previsao:'' });
  });

  // ========= Relatórios (admin) — agora com Authorization =========
  function bindAdminReportButtons(){
    if (btnTop) btnTop.addEventListener('click', async ()=>{
      try {
        const {start,end}=getAdminPeriod();
        await downloadAuth('/api/reports/top-ofensores.xlsx', {start,end,companyId:0},
          `top_ofensores_${start}_a_${end}.xlsx`);
      } catch (e) { console.error(e); alert('Falha ao gerar Excel de Top 10 Ofensores.'); }
    });
    if (btnAtr) btnAtr.addEventListener('click', async ()=>{
      try {
        const {start,end}=getAdminPeriod();
        await downloadAuth('/api/reports/atrasos.xlsx', {start,end,companyId:0},
          `resumo_atrasos_${start}_a_${end}.xlsx`);
      } catch (e) { console.error(e); alert('Falha ao gerar Excel de Atrasos.'); }
    });
  }

  // ========= KPIs clicáveis ⇒ “nova tela” (modal) =========
  function bindKpiClicks(){
    document.querySelectorAll('.kpi-card[data-filter]')?.forEach(el=>{
      el.style.cursor = 'pointer';
      el.addEventListener('click', ()=> openFilteredModal(el.dataset.filter));
    });
  }

  async function fetchAllOps(filters={}){
    const list = [];
    let page = 1;
    for(;;){
      const q = qs({ page, pageSize: BULK_SIZE, ...filters });
      try{
        const payload = await apiGet(`/api/client/operations?${q}`);
        const chunk = payload.items || payload.rows || payload.data || [];
        list.push(...chunk);
        if (chunk.length < BULK_SIZE) break;
        page++;
      }catch{ break; }
    }
    return list;
  }

  function filterByMode(items, mode){
    if (mode === 'total') return items;
    const isLate = s => /atras/.test((s||'').toLowerCase());
    const isOn   = s => /(on ?time|no prazo|pontual|sem atraso)/.test((s||'').toLowerCase());
    return items.filter(op => {
      const s = op.status_operacao || op.status || '';
      if (mode === 'atrasadas') return isLate(s);
      if (mode === 'on_time')   return isOn(s);
      return true;
    });
  }

  function openFilteredModal(mode){
    const titles = { total: 'Todas as operações', on_time: 'Operações On Time', atrasadas: 'Operações Atrasadas' };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:5%;background:#fff;color:#111;border-radius:14px;padding:16px;z-index:9999;overflow:auto;';
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
        const all = await fetchAllOps(currentFilters);
        const sub = filterByMode(all, mode);
        const html = renderMiniTable(sub);
        document.getElementById('modalContent').innerHTML = html;
      }catch(e){
        document.getElementById('modalContent').textContent = 'Falha ao carregar operações.';
      }
    })();
  }

  function renderMiniTable(items){
    if (!items.length) return '<p>Nenhuma operação.</p>';
    const rows = items.slice(0,1000).map(op=>`
      <tr>
        <td>${safe(op.booking)}</td>
        <td>${safe(op.containers)}</td>
        <td>${safe(op.nome_embarcador || op.embarcador || 'N/A')}</td>
        <td>${fmt(op.previsao_inicio_atendimento)}</td>
        <td>${fmt(op.dt_inicio_execucao)}</td>
        <td>${fmt(op.dt_fim_execucao)}</td>
        <td>${safe(op.status_operacao || op.status || 'N/A')}</td>
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

  // Assistente (atalho)
  window.openAssistant = () => {
    const df = document.querySelector('df-messenger');
    if (df) df.setAttribute('expanded','true');
  };

})(); 