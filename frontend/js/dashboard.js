/* ===== util ===== */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const API = () => (window.API_BASE || '/api');

async function authToken() {
  const u = firebase.auth().currentUser;
  if (!u) throw new Error('Não autenticado.');
  return u.getIdToken(true);
}

async function apiGet(path, params={}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && `${v}`.trim() !== '') q.append(k, v);
  });
  const url = `${API()}${path}${q.toString() ? `?${q}` : ''}`;
  const token = await authToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${res.statusText} :: ${text.slice(0,180)}`);
  }
  return res.json();
}

async function apiPost(path, body={}) {
  const token = await authToken();
  const res = await fetch(`${API()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiDelete(path) {
  const token = await authToken();
  const res = await fetch(`${API()}${path}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` }});
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json().catch(()=> ({}));
}

/* ===== estado ===== */
const state = {
  page: 1,
  limit: 50,
  charts: {
    offenders: null,
    clients: null
  }
};

/* ===== helpers UI ===== */
function toast(el, msg, isErr=false) {
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
  if (!msg) el.removeAttribute('style');
}

function collectFilters() {
  return {
    embarcador: $('#embarcadorFilter').value || undefined,
    booking: $('#bookingFilter').value || undefined,
    container: $('#containerFilter').value || undefined,
    start: $('#startDateFilter').value || undefined,
    end: $('#endDateFilter').value || undefined
  };
}

function fmtDate(x) {
  if (!x) return 'N/A';
  // assume ISO do backend
  try { return new Date(x).toLocaleString('pt-BR'); } catch { return x; }
}

function buildDetails(op) {
  return `
    <div class="op-details">
      <b>Tipo de Programação:</b> ${op.tipo_programacao ?? 'N/A'}  •
      <b>Status:</b> ${op.status ?? 'N/A'}  •
      <b>Nº Programação:</b> ${op.numero_programacao ?? 'N/A'}<br>
      <b>Motorista:</b> ${op.motorista_nome ?? 'N/A'} —
      <b>CPF:</b> ${op.motorista_cpf ?? 'N/A'}<br>
      <b>Placa Veículo:</b> ${op.placa_veiculo ?? 'N/A'}  •
      <b>Placa Carreta:</b> ${op.placa_carreta ?? 'N/A'}  •
      <b>Nº Cliente:</b> ${op.numero_cliente ?? 'N/A'}
    </div>`;
}

/* ===== kpis + charts ===== */
function ensureBarHorizontal(canvas, labels, values, title) {
  const ctx = canvas.getContext('2d');
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: title || 'Ocorrências',
        data: values,
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, title: { display: true, text: 'Ocorrências' } },
        y: { ticks: { autoSkip: false } }
      }
    }
  };

  // (re)cria com segurança
  if (canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }
  canvas._chart = new Chart(ctx, cfg);
  return canvas._chart;
}

async function loadKpisAndCharts() {
  const params = collectFilters();
  const data = await apiGet('/dashboard/kpis', params);

  // KPIs
  $('#kpiTotalValue').textContent = data.total ?? 0;
  $('#kpiOnTimeValue').textContent = data.on_time ?? 0;
  $('#kpiLateValue').textContent = data.late ?? 0;
  const pct = (data.total > 0) ? ((data.late / data.total) * 100).toFixed(2) : '0.00';
  $('#kpiLatePct').textContent = `${pct}%`;

  // Gráfico 1 — Top ofensores (motivos)
  const c1 = $('#topOffendersChart');
  ensureBarHorizontal(
    c1,
    (data.top_offenders || []).map(d => d.label),
    (data.top_offenders || []).map(d => d.value),
    'Top Ofensores'
  );

  // Gráfico 2 — Top clientes
  const c2 = $('#topClientsChart');
  ensureBarHorizontal(
    c2,
    (data.top_clients || []).map(d => d.label),
    (data.top_clients || []).map(d => d.value),
    'Top Clientes'
  );
}

/* ===== operações ===== */
async function loadOperations(page=1) {
  state.page = page;
  const params = { ...collectFilters(), page: state.page, limit: state.limit };
  const r = await apiGet('/operations', params);

  const list = r.items || r.rows || [];
  const tbody = $('#opsTbody');
  tbody.innerHTML = '';

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">Nenhuma operação.</td></tr>`;
  } else {
    list.forEach(op => {
      const tr = document.createElement('tr');
      tr.className = 'op-row';
      tr.innerHTML = `
        <td>${op.booking ?? 'N/A'}</td>
        <td>${op.container ?? 'N/A'}</td>
        <td>${op.embarcador ?? 'N/A'}</td>
        <td>${op.porto ?? 'N/A'}</td>
        <td>${fmtDate(op.previsao_atendimento)}</td>
        <td>${fmtDate(op.inicio_execucao)}</td>
        <td>${fmtDate(op.fim_execucao)}</td>
        <td>${op.atraso_hhmm ?? 'N/A'}</td>
        <td>${op.motivo_atraso ?? 'N/A'}</td>
      `;
      tr.addEventListener('click', () => {
        // toggle details row
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('op-details-row')) {
          next.remove();
          return;
        }
        const dtr = document.createElement('tr');
        dtr.className = 'op-details-row';
        const td = document.createElement('td');
        td.colSpan = 9;
        td.innerHTML = buildDetails(op);
        dtr.appendChild(td);
        tr.insertAdjacentElement('afterend', dtr);
      });
      tbody.appendChild(tr);
    });
  }

  // paginação
  const total = r.total || 0;
  const pages = Math.max(1, Math.ceil(total / state.limit));
  $('#pageInfo').textContent = `Página ${state.page} de ${pages}`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= pages;
}

async function loadModalList(kind) {
  // kind: 'on_time' | 'late'
  const params = { ...collectFilters(), page: 1, limit: 200, status: kind };
  const r = await apiGet('/operations', params);
  const list = r.items || r.rows || [];

  const title = (kind === 'late') ? 'Operações Atrasadas' : 'Operações On Time';
  $('#modalTitle').textContent = title;

  const body = $('#modalBody');
  if (!list.length) {
    body.innerHTML = `<p class="muted">Nenhuma operação.</p>`;
  } else {
    const html = [
      `<table class="table compact"><thead><tr>
        <th>Booking</th><th>Contêiner</th><th>Embarcador</th>
        <th>Prev. Atendimento</th><th>Início Execução</th><th>Fim Execução</th>
      </tr></thead><tbody>`
    ];
    list.forEach(x => {
      html.push(`<tr>
        <td>${x.booking ?? 'N/A'}</td>
        <td>${x.container ?? 'N/A'}</td>
        <td>${x.embarcador ?? 'N/A'}</td>
        <td>${fmtDate(x.previsao_atendimento)}</td>
        <td>${fmtDate(x.inicio_execucao)}</td>
        <td>${fmtDate(x.fim_execucao)}</td>
      </tr>`);
    });
    html.push(`</tbody></table>`);
    body.innerHTML = html.join('');
  }

  openModal();
}

/* ===== aliases ===== */
async function loadAliases() {
  const tBody = $('#aliasesTbody');
  tBody.innerHTML = `<tr><td colspan="3" class="muted">Carregando…</td></tr>`;
  try {
    const rows = await apiGet('/aliases');
    if (!rows.length) {
      tBody.innerHTML = `<tr><td colspan="3" class="muted">Nenhum apelido cadastrado.</td></tr>`;
      return;
    }
    tBody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.alias}</td>
        <td>${r.master}</td>
        <td>
          <button class="button-secondary btn-remove" data-id="${r.id}">Remover</button>
        </td>
      `;
      tBody.appendChild(tr);
    });

    tBody.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.btn-remove');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      btn.disabled = true;
      try {
        await apiDelete(`/aliases/${id}`);
        await loadAliases();
        toast($('#aliasesMsg'), 'Apelido removido.');
      } catch (e) {
        toast($('#aliasesMsg'), `Erro: ${e.message}`, true);
      } finally {
        btn.disabled = false;
      }
    }, { once:true });

  } catch (e) {
    tBody.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar apelidos.</td></tr>`;
    toast($('#aliasesMsg'), e.message, true);
  }
}

async function saveAlias() {
  const alias = $('#aliasDirty').value.trim();
  const master = $('#aliasMaster').value.trim();
  if (!alias || !master) {
    toast($('#aliasesMsg'), 'Informe “Nome sujo” e “Associar ao Mestre”.', true);
    return;
  }
  try {
    await apiPost('/aliases', { alias, master });
    $('#aliasDirty').value = '';
    $('#aliasMaster').value = '';
    toast($('#aliasesMsg'), 'Apelido salvo/atualizado.');
    await loadAliases();
  } catch (e) {
    toast($('#aliasesMsg'), `Erro: ${e.message}`, true);
  }
}

/* ===== embarcadores para filtro ===== */
async function loadEmbarcadores() {
  try {
    const list = await apiGet('/embarcador/list');
    const sel = $('#embarcadorFilter');
    const current = sel.value;
    sel.innerHTML = `<option value="">Todos Embarcadores</option>`;
    (list || []).forEach(x => {
      const opt = document.createElement('option');
      opt.value = x.nome || x.id || '';
      opt.textContent = x.nome || x.id || '';
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  } catch {
    // silencioso — não bloqueia dashboard
  }
}

/* ===== modal ===== */
function openModal() {
  $('#modal').classList.remove('hidden');
  $('#modal').setAttribute('aria-hidden','false');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').setAttribute('aria-hidden','true');
}

/* ===== eventos ===== */
function bindEvents() {
  // auth + header
  firebase.auth().onAuthStateChanged(u => {
    if (!u) { window.location.href = 'index.html'; return; }
    $('#userEmail').textContent = `Olá, ${u.email}`;
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await firebase.auth().signOut();
    window.location.href = 'index.html';
  });

  // filtros
  $('#filterButton').addEventListener('click', async () => {
    // recarrega todos os blocos
    await Promise.all([loadKpisAndCharts(), loadOperations(1)]);
  });
  $('#clearFilterButton').addEventListener('click', async () => {
    $('#embarcadorFilter').value = '';
    $('#bookingFilter').value = '';
    $('#containerFilter').value = '';
    $('#startDateFilter').value = '';
    $('#endDateFilter').value = '';
    await Promise.all([loadKpisAndCharts(), loadOperations(1)]);
  });

  // paginação
  $('#prevPage').addEventListener('click', () => { if (state.page > 1) loadOperations(state.page - 1); });
  $('#nextPage').addEventListener('click', () => { loadOperations(state.page + 1); });

  // modais via KPI
  $('#kpiOnTime').addEventListener('click', () => loadModalList('on_time'));
  $('#kpiLate').addEventListener('click', () => loadModalList('late'));
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', closeModal);

  // aliases
  $('#aliasSave').addEventListener('click', saveAlias);

  // upload / clear (endpoints opcionais — adapte aos seus)
  $('#sendUpload').addEventListener('click', async () => {
    const f = $('#uploadFile').files[0];
    if (!f) { toast($('#uploadMsg'),'Selecione um arquivo.', true); return; }
    try {
      const token = await authToken();
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`${API()}/operations/upload`, {
        method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: fd
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      toast($('#uploadMsg'), 'Upload processado.');
      await Promise.all([loadKpisAndCharts(), loadOperations(1)]);
    } catch (e) {
      toast($('#uploadMsg'), `Erro: ${e.message}`, true);
    }
  });

  $('#clearOps').addEventListener('click', async () => {
    if (!confirm('Tem certeza que deseja limpar todas as operações?')) return;
    try {
      await apiDelete('/operations/all');
      toast($('#uploadMsg'), 'Operações removidas.');
      await Promise.all([loadKpisAndCharts(), loadOperations(1)]);
    } catch (e) {
      toast($('#uploadMsg'), `Erro: ${e.message}`, true);
    }
  });
}

/* ===== bootstrap ===== */
(async function init() {
  bindEvents();
  await loadEmbarcadores();
  await Promise.all([
    loadKpisAndCharts(),
    loadOperations(1),
    loadAliases()
  ]);
})();