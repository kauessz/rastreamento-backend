(() => {
  // ======== Helpers ========
  const $ = (sel) => document.querySelector(sel);
  const el = {
    whoami: $("#whoami"),
    logoutBtn: $("#logoutBtn"),
    themeBtn: $("#themeBtn"),
    sendXlsxBtn: $("#sendXlsxBtn"),
    xlsxFile: $("#xlsxFile"),
    wipeBtn: $("#wipeBtn"),

    aliasDirty: $("#aliasDirty"),
    aliasMaster: $("#aliasMaster"),
    aliasSaveBtn: $("#aliasSaveBtn"),
    aliasTbody: $("#aliasTbody"),

    filterCompany: $("#filterCompany"),
    filterBooking: $("#filterBooking"),
    filterContainer: $("#filterContainer"),
    filterStart: $("#filterStart"),
    filterEnd: $("#filterEnd"),
    applyBtn: $("#applyBtn"),
    clearBtn: $("#clearBtn"),

    kpiTotal: $("#kpiTotal"),
    kpiOnTime: $("#kpiOnTime"),
    kpiLate: $("#kpiLate"),
    kpiPct: $("#kpiPct"),

    offendersChart: $("#offendersChart"),
    clientsChart: $("#clientsChart"),
    opsArea: $("#opsArea"),
    pendingUsers: $("#pendingUsers"),
  };

  const API = window.API_BASE || "";
  if (!API) console.warn("API_BASE não definido!");

  const charts = { offenders: null, clients: null };
  const CHART_HEIGHT = 320; // px
  let lastOpsItems = [];     // última lista carregada (para o modal dos KPIs)

  // ======== Tema ========
  function applyTheme(t) {
    document.body.classList.remove("light-mode", "dark-mode");
    document.body.classList.add(t);
    el.themeBtn && (el.themeBtn.textContent = t === "dark-mode" ? "☀️" : "🌙");
    localStorage.setItem("theme", t);
  }
  function toggleTheme() {
    const now = localStorage.getItem("theme") || "light-mode";
    applyTheme(now === "light-mode" ? "dark-mode" : "light-mode");
  }
  applyTheme(localStorage.getItem("theme") || "light-mode");
  el.themeBtn?.addEventListener("click", toggleTheme);

  // ======== Auth ========
  function authReady() {
    return new Promise((resolve) => {
      const cur = firebase.auth().currentUser;
      if (cur) return resolve(cur);
      firebase.auth().onAuthStateChanged((u) => resolve(u));
    });
  }
  async function token(force = false) {
    const u = await authReady();
    if (!u) throw new Error("Não autenticado.");
    return await u.getIdToken(force);
  }

  async function apiGet(path, params = {}) {
    const url = new URL(API + path);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const t = await token();
    const res = await fetch(url.toString(), { headers: { Authorization: "Bearer " + t } });
    if (!res.ok) throw new Error(await safeText(res));
    return await res.json();
  }
  async function apiPost(path, body = {}) {
    const t = await token();
    const res = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await safeText(res));
    return await res.json();
  }
  async function apiDelete(path) {
    const t = await token();
    const res = await fetch(API + path, { method: "DELETE", headers: { Authorization: "Bearer " + t } });
    if (!res.ok) throw new Error(await safeText(res));
    return await res.json();
  }
  async function safeText(r){ try { return await r.text(); } catch { return String(r.status); } }

  // ======== Header ========
  firebase.auth().onAuthStateChanged((u) => {
    el.whoami.textContent = u ? `Olá, ${u.email}` : "";
    if (!u) location.href = "./login.html";
  });
  el.logoutBtn?.addEventListener("click", async () => {
    await firebase.auth().signOut();
    location.href = "./login.html";
  });

  // ======== Upload / Wipe ========
  el.sendXlsxBtn?.addEventListener("click", async () => {
    if (!el.xlsxFile.files[0]) return alert("Escolha um arquivo .xlsx");
    try {
      const form = new FormData();
      form.append("file", el.xlsxFile.files[0]);
      const t = await token();
      const res = await fetch(API + "/api/operations/upload-xlsx", {
        method: "POST",
        headers: { Authorization: "Bearer " + t },
        body: form
      });
      if (!res.ok) throw new Error(await safeText(res));
      alert("Upload concluído.");
      loadAll();
    } catch (e) {
      console.error(e);
      alert("Falha no upload: " + e.message);
    }
  });

  el.wipeBtn?.addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja APAGAR todas as operações?")) return;
    try {
      await apiPost("/api/operations/wipe");
      alert("Operações removidas.");
      loadAll();
    } catch (e) {
      console.error(e);
      alert("Erro ao limpar: " + e.message);
    }
  });

  // ======== Apelidos ========
  async function loadAliases() {
    try {
      const data = await apiGet("/api/aliases");
      if (!Array.isArray(data) || data.length === 0) {
        el.aliasTbody.innerHTML = `<tr><td colspan="3" class="muted">Nenhum apelido cadastrado.</td></tr>`;
        return;
      }
      el.aliasTbody.innerHTML = data.map((a) => {
        const alias  = a.alias || a.dirty_name || a.dirty || "-";
        const master = a.master || a.master_name || a.nome_mestre || "-";
        return `<tr>
          <td>${alias}</td>
          <td>${master}</td>
          <td><button class="btn btn-outline" data-del="${a.id}">Excluir</button></td>
        </tr>`;
      }).join("");
      el.aliasTbody.querySelectorAll("[data-del]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          try { await apiDelete(`/api/aliases/${btn.dataset.del}`); loadAliases(); }
          catch (e) { alert("Erro ao excluir: " + e.message); }
        })
      );
    } catch (e) {
      console.error(e);
      el.aliasTbody.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar apelidos.</td></tr>`;
    }
  }

  el.aliasSaveBtn?.addEventListener("click", async () => {
    const dirty = el.aliasDirty.value.trim();
    const master = el.aliasMaster.value.trim();
    if (!dirty || !master) return alert("Preencha os dois campos.");
    try {
      await apiPost("/api/aliases", { alias: dirty, master });
      el.aliasDirty.value = ""; el.aliasMaster.value = "";
      loadAliases();
    } catch (e) {
      try {
        await apiPost("/api/aliases", { dirty_name: dirty, master_name: master });
        el.aliasDirty.value = ""; el.aliasMaster.value = "";
        loadAliases();
      } catch (err) { alert("Erro ao salvar: " + err.message); }
    }
  });

  // ======== Filtros & util ========
  function readFilters() {
    return {
      companyId: el.filterCompany?.value || "",
      booking: el.filterBooking?.value?.trim(),
      container: el.filterContainer?.value?.trim(),
      start: el.filterStart?.value || "",
      end: el.filterEnd?.value || "",
    };
  }
  async function loadCompaniesIntoFilter() {
    try {
      const list = await apiGet("/api/dashboard/companies");
      if (!el.filterCompany) return;
      el.filterCompany.innerHTML = `<option value="">Todos Embarcadores</option>` +
        (list || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    } catch (e) { console.warn("companies:", e.message); }
  }

  // ======== Chart helpers ========
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hexToRgba(hex, alpha = 1) {
    let h = hex.replace('#','').trim();
    if (h.length === 3) h = h.split('').map(x => x+x).join('');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function prepCanvas(canvas) {
    if (!canvas) return;
    const p = canvas.parentElement;
    if (p) { p.style.position = "relative"; p.style.height = CHART_HEIGHT + "px"; }
    canvas.style.width = "100%";
    canvas.style.height = CHART_HEIGHT + "px";
    canvas.removeAttribute("height");
    canvas.removeAttribute("width");
  }
  function makeHorizontalBar(ctx, labels, values, label) {
    const primary = cssVar('--dash-primary', '#1677ff');
    const bg = hexToRgba(primary, 0.35);
    const border = hexToRgba(primary, 1);
    return new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label, data: values, backgroundColor: bg, borderColor: border, borderWidth: 1 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { autoSkip: false } } },
        plugins: { legend: { display: true } }
      }
    });
  }

  // ======== KPIs/Charts/Lista ========
  async function loadKpisAndCharts() {
    const f = readFilters();
    try {
      const k = await apiGet("/api/dashboard/kpis", f);

      const total  = Number(k.total || 0);
      const late   = Number(k.late  || 0);
      const onTime = Number(k.onTime || 0);
      const pct = total ? Math.round((late / total) * 10000) / 100 : 0;

      el.kpiTotal.textContent = total;
      el.kpiOnTime.textContent = onTime;
      el.kpiLate.textContent = late;
      el.kpiPct.textContent = pct.toFixed(2).replace('.', ',') + "%";

      prepCanvas(el.offendersChart);
      prepCanvas(el.clientsChart);
      charts.offenders?.destroy(); charts.clients?.destroy();

      const offenders = k.topOffenders || [];
      const clients   = k.topClients   || [];

      if (el.offendersChart) {
        charts.offenders = makeHorizontalBar(
          el.offendersChart.getContext("2d"),
          offenders.map(x => x.reason),
          offenders.map(x => x.count),
          "Ocorrências"
        );
      }
      if (el.clientsChart) {
        charts.clients = makeHorizontalBar(
          el.clientsChart.getContext("2d"),
          clients.map(x => x.client),
          clients.map(x => x.count),
          "Atrasos"
        );
      }
    } catch (e) {
      console.error(e);
      el.kpiTotal.textContent = "0";
      el.kpiOnTime.textContent = "0";
      el.kpiLate.textContent = "0";
      el.kpiPct.textContent = "0%";
    }
  }

  function opRow(o) {
    return `
      <tr class="main-row">
        <td>${o.booking || "-"}</td>
        <td>${o.container || "-"}</td>
        <td>${o.client || "-"}</td>
        <td>${o.port || "-"}</td>
        <td>${o.sla_previsao || "-"}</td>
        <td>${o.exec_inicio || "-"}</td>
        <td>${o.exec_fim || "-"}</td>
        <td>${o.atraso_hhmm || "-"}</td>
        <td>${o.motivo || "-"}</td>
      </tr>
      <tr class="details-row">
        <td colspan="9" class="muted">
          <b>Tipo de Operação:</b> ${o.tipo_operacao || "N/A"} —
          <b>Transportadora:</b> ${o.transportadora || "N/A"} —
          <b>Nº Programação:</b> ${o.num_programacao || "N/A"} —
          <b>Motorista:</b> ${o.motorista || "N/A"} —
          <b>CPF:</b> ${o.cpf || "N/A"} —
          <b>Placa Veículo:</b> ${o.placa_veiculo || "N/A"} —
          <b>Placa Carreta:</b> ${o.placa_carreta || "N/A"} —
          <b>Nº Cliente:</b> ${o.numero_cliente || "N/A"}
        </td>
      </tr>`;
  }

  function setupOpToggles() {
    const rows = document.querySelectorAll("#opsArea table tbody tr.main-row");
    rows.forEach((tr) => {
      tr.addEventListener("click", () => {
        const det = tr.nextElementSibling;
        if (det && det.classList.contains("details-row")) det.classList.toggle("visible");
      });
    });
  }

  async function loadOperations() {
    const f = readFilters();
    try {
      const data = await apiGet("/api/dashboard/operations", f);
      const items = Array.isArray(data?.items) ? data.items : [];
      lastOpsItems = items; // guarda para o modal dos KPIs

      if (items.length === 0) {
        el.opsArea.innerHTML = `<div class="muted">Nenhuma operação encontrada.</div>`;
        return;
      }
      el.opsArea.innerHTML = `
        <div class="table-wrapper">
          <table class="operations-table">
            <thead>
              <tr>
                <th>Booking</th><th>Contêiner</th><th>Embarcador</th><th>Porto</th>
                <th>Previsão Atendimento</th><th>Início Execução</th><th>Fim Execução</th>
                <th>Atraso (HH:MM)</th><th>Motivo do Atraso</th>
              </tr>
            </thead>
            <tbody>${items.map(opRow).join("")}</tbody>
          </table>
        </div>`;
      setupOpToggles();
    } catch (e) {
      console.error(e);
      el.opsArea.innerHTML = `<div class="muted">Falha ao carregar operações.</div>`;
    }
  }

  async function loadPendingUsers() {
    try {
      const x = await apiGet("/api/dashboard/pending-users");
      el.pendingUsers.textContent = Array.isArray(x) && x.length ? `${x.length} pendentes` : "—";
    } catch { el.pendingUsers.textContent = "—"; }
  }

  // ======== Modal dos KPIs ========
  function minutesFromHHMM(hhmm){
    const [h='0', m='0'] = String(hhmm||'00:00').split(':');
    return (parseInt(h)||0)*60 + (parseInt(m)||0);
  }
  function isLateOp(op){ return minutesFromHHMM(op.atraso_hhmm) > 0; }
  function filterByStatus(items, status){
    if (status === 'late')   return items.filter(isLateOp);
    if (status === 'onTime') return items.filter(o => !isLateOp(o));
    return items; // 'all'
  }
  function renderOpsTable(items){
    return `<div class="table-wrapper">
      <table class="operations-table">
        <thead>
          <tr>
            <th>Booking</th><th>Contêiner</th><th>Embarcador</th><th>Porto</th>
            <th>Previsão Atendimento</th><th>Início Execução</th><th>Fim Execução</th>
            <th>Atraso (HH:MM)</th><th>Motivo do Atraso</th>
          </tr>
        </thead>
        <tbody>${items.map(opRow).join('')}</tbody>
      </table>
    </div>`;
  }
  function openKpiModal(status){
    const modal = document.getElementById('kpiModal');
    const title = document.getElementById('kpiModalTitle');
    const body  = document.getElementById('kpiModalBody');

    const items = filterByStatus(lastOpsItems, status);
    title.textContent =
      status === 'late'   ? `Operações atrasadas (${items.length})` :
      status === 'onTime' ? `Operações on time (${items.length})` :
                            `Todas as operações (${items.length})`;

    body.innerHTML = renderOpsTable(items);
    modal.hidden = false;

    // habilita expand/collapse dentro do modal também
    setupOpToggles();

    modal.querySelectorAll('[data-close]').forEach(btn => btn.onclick = () => (modal.hidden = true));
    modal.onkeydown = (e) => { if (e.key === 'Escape') modal.hidden = true; };
  }

  // KPIs clicáveis → abre o modal com a lista filtrada
  document.querySelectorAll(".kpi-card").forEach(card => {
    card.addEventListener("click", () => openKpiModal(card.dataset.filter || 'all'));
  });
  el.kpiTotal?.addEventListener("click", ()=> openKpiModal('all'));
  el.kpiOnTime?.addEventListener("click", ()=> openKpiModal('onTime'));
  el.kpiLate?.addEventListener("click", ()=> openKpiModal('late'));

  // ======== Filtros ========
  el.applyBtn?.addEventListener("click", () => loadAll());
  el.clearBtn?.addEventListener("click", () => {
    if (el.filterCompany) el.filterCompany.value = "";
    if (el.filterBooking) el.filterBooking.value = "";
    if (el.filterContainer) el.filterContainer.value = "";
    if (el.filterStart) el.filterStart.value = "";
    if (el.filterEnd) el.filterEnd.value = "";
    loadAll();
  });

  // ======== Boot ========
  async function loadAll() {
    await Promise.all([ loadKpisAndCharts(), loadOperations(), loadAliases(), loadPendingUsers() ]);
  }
  (async function boot() {
    try {
      await authReady();
      await loadCompaniesIntoFilter();
      await loadAll();
    } catch (e) {
      console.error("Erro ao iniciar dashboard:", e);
      alert("Erro: " + (e.message || e));
    }
  })();
})();