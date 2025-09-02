(() => {
  // ========= Base/API =========
  window.API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
  const API = window.API_BASE_URL;
  const PAGE_SIZE = 10;

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
  const userEmailEl = document.getElementById('userEmail');
  const kpiTotalValue  = document.querySelector('#kpi-total .kpi-value');
  const kpiOntimeValue = document.querySelector('#kpi-ontime .kpi-value');
  const kpiLateValue   = document.querySelector('#kpi-atrasadas .kpi-value');
  const kpiPctValue    = document.querySelector('#kpi-percentual .kpi-value');

  const bookingFilter = document.getElementById('bookingFilter');
  const dataPrevFilter= document.getElementById('dataPrevisaoFilter');
  const filterBtn     = document.getElementById('filterButton');
  const clearBtn      = document.getElementById('clearFilterButton');

  const tableBodyEl   = document.querySelector('#clientOperationsTable tbody') ||
                        document.querySelector('#operationsTable tbody') ||
                        document.querySelector('table tbody');
  const paginationEl  = document.getElementById('paginationControls') ||
                        document.getElementById('pagination');

  // ========= Estado =========
  let currentUser  = null;
  let currentToken = null;
  let currentPage  = 1;
  let currentFilters = { booking: '', data_previsao: '' };
  window.CLIENT_COMPANY_ID = window.CLIENT_COMPANY_ID || 0;
  window.AUTH_EMAIL        = window.AUTH_EMAIL || '';

  // ========= Utils =========
  const fmt = (iso) => { try { return iso ? new Date(iso).toLocaleString('pt-BR') : 'N/A'; } catch { return 'N/A'; } };
  const safe = (v) => (v==null || v==='') ? 'N/A' : String(v);
  const qs   = (o) => {const p=new URLSearchParams(); for (const [k,v] of Object.entries(o)) if(v!=null&&v!=='') p.append(k,v); return p.toString();};
  const todayISO = () => (new Date()).toISOString().slice(0,10);
  const defaultPeriod = () => {const end=todayISO(); const s=new Date(Date.now()-30*864e5).toISOString().slice(0,10); return {start:s,end};};

  // ========= HTTP helpers (com Authorization) =========
  async function apiGet(path, withAuth=true){
    const headers={'Accept':'application/json','Content-Type':'application/json'};
    if(withAuth && currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const r = await fetch(`${API}${path}`, {headers});
    const raw = await r.text();
    if(!r.ok){
      // tenta extrair mensagem JSON; senão devolve o texto cru (ex.: HTML 404)
      try { const j = JSON.parse(raw); throw new Error(j.message || j.error || `HTTP ${r.status}`); }
      catch { throw new Error(raw || `HTTP ${r.status}`); }
    }
    return raw ? JSON.parse(raw) : {};
  }
  async function apiFetchBlob(path, params) {
    const q = params ? `?${new URLSearchParams(params).toString()}` : '';
    const headers = currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
    const resp = await fetch(`${API}${path}${q}`, { headers });
    const blob = await resp.blob();
    if(!resp.ok){
      // tenta ler mensagem de erro, se vier JSON/text
      try {
        const text = await blob.text();
        throw new Error(text || `HTTP ${resp.status}`);
      } catch {
        throw new Error(`HTTP ${resp.status}`);
      }
    }
    return blob;
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

  // ========= Auth =========
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    currentUser = user;
    userEmailEl && (userEmailEl.textContent = `Olá, ${user.email}`);
    window.AUTH_EMAIL = user.email;

    try { currentToken = await user.getIdToken(); }
    catch (e) { console.error('Token error:', e); window.location.href='login.html'; return; }

    // logout
    document.getElementById('logoutButton')?.addEventListener('click', async () => {
      try { await firebase.auth().signOut(); } finally { window.location.href = 'login.html'; }
    });

    await resolveClientCompanyId();

    const def = defaultPeriod();
    const s = document.getElementById('repStartClient');
    const e = document.getElementById('repEndClient');
    if (s) s.value = def.start;
    if (e) e.value = def.end;
    bindClientReportButtons();

    await fetchKpis();
    await fetchOps(1, currentFilters);
  });

  async function resolveClientCompanyId(){
    if (Number(window.CLIENT_COMPANY_ID) > 0) return;
    try {
      const profile = await apiGet('/api/client/profile');
      if (profile && Number(profile.embarcador_id)>0){
        window.CLIENT_COMPANY_ID = Number(profile.embarcador_id);
        if (!window.AUTH_EMAIL && profile.email) window.AUTH_EMAIL = profile.email;
      }
    } catch(e){ console.warn('profile indisponível:', e); }
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

  // ========= Tabela (6 colunas) =========
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
      td.colSpan=6; td.textContent='Nenhuma operação encontrada.'; tr.appendChild(td); tableBodyEl.appendChild(tr); return;
    }
    items.forEach(op=>{
      // linha principal
      const tr=document.createElement('tr'); tr.className='operation-row';
      [ safe(op.booking),
        safe(op.containers),
        safe(op.status_operacao || op.status || 'N/A'),
        fmt(op.previsao_inicio_atendimento),
        fmt(op.dt_inicio_execucao),
        fmt(op.dt_fim_execucao)
      ].forEach(t=>{const td=document.createElement('td'); td.textContent=t; tr.appendChild(td);});
      tableBodyEl.appendChild(tr);

      // detalhes
      const dr=document.createElement('tr'); dr.className='details-row';
      const dt=document.createElement('td'); dt.colSpan=6;
      dt.innerHTML = `
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
      dr.appendChild(dt); tableBodyEl.appendChild(dr);
    });
  }

  // clique na linha alterna os detalhes
  tableBodyEl?.addEventListener('click',(e)=>{
    const row=e.target.closest('tr.operation-row'); if(!row) return;
    const next=row.nextElementSibling;
    if(next && next.classList.contains('details-row')){
      next.classList.toggle('visible'); // .details-row.visible => display: table-row
    }
  });

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

  // Filtros
  filterBtn?.addEventListener('click', ()=>{
    fetchOps(1, { booking: bookingFilter?.value||'', data_previsao: dataPrevFilter?.value||'' });
  });
  clearBtn?.addEventListener('click', ()=>{
    if(bookingFilter) bookingFilter.value='';
    if(dataPrevFilter) dataPrevFilter.value='';
    fetchOps(1, { booking:'', data_previsao:'' });
  });

  // Assistente
  window.openAssistant = () => {
    const df = document.querySelector('df-messenger');
    if (df) df.setAttribute('expanded','true');
  };
  document.body.addEventListener('click', async (e)=>{
    const btn=e.target.closest('.ask-assistant'); if(!btn) return;
    const q=btn.dataset.query||'ajuda';
    try{ await navigator.clipboard.writeText(q);}catch{}
    window.openAssistant();
    alert('Abri o assistente. Cole a pergunta e envie:\n\n' + q);
  });

  // Excel (AUTENTICADO)
  function getPeriod(){
    const s=document.getElementById('repStartClient')?.value;
    const e=document.getElementById('repEndClient')?.value;
    if(!s||!e){const d=defaultPeriod();return d;}
    return {start:s,end:e};
  }
  function bindClientReportButtons(){
    const btnTop  = document.getElementById('btnExcelTopClient');
    const btnAtr  = document.getElementById('btnExcelAtrasosClient');
    if (btnTop) btnTop.addEventListener('click', async ()=>{
      try{
        const {start,end}=getPeriod(); const companyId=window.CLIENT_COMPANY_ID||0;
        await downloadAuth('/api/reports/top-ofensores.xlsx',{start,end,companyId},
          `top_ofensores_${start}_a_${end}.xlsx`);
      }catch(e){ console.error(e); alert('Falha ao gerar Excel de Top 10 Ofensores.');}
    });
    if (btnAtr) btnAtr.addEventListener('click', async ()=>{
      try{
        const {start,end}=getPeriod(); const companyId=window.CLIENT_COMPANY_ID||0;
        await downloadAuth('/api/reports/atrasos.xlsx',{start,end,companyId},
          `resumo_atrasos_${start}_a_${end}.xlsx`);
      }catch(e){ console.error(e); alert('Falha ao gerar Excel de Atrasos.');}
    });
  }
})();