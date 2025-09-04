(() => {
  // ======== Helpers básicos ========
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

  // página de lista que deve abrir ao clicar nos KPIs (ajuste se for outra)
  const LIST_PAGE_PATH = "/client-dashboard/index.html";

  let charts = {
    offenders: null,
    clients: null,
  };

  const API = window.API_BASE || "";
  if (!API) console.warn("API_BASE não definido!");

  // ======== Tema claro/escuro ========
  function applyTheme(t) {
    document.body.classList.remove("light-mode", "dark-mode");
    document.body.classList.add(t);
    el.themeBtn.textContent = t === "dark-mode" ? "☀️" : "🌙";
    localStorage.setItem("theme", t);
  }
  function toggleTheme() {
    const now = localStorage.getItem("theme") || "light-mode";
    const next = now === "light-mode" ? "dark-mode" : "light-mode";
    applyTheme(next);
  }
  applyTheme(localStorage.getItem("theme") || "light-mode");
  el.themeBtn.addEventListener("click", toggleTheme);

  // ======== Firebase/Auth ========
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
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async function apiPost(path, body = {}) {
    const t = await token();
    const res = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async function apiDelete(path) {
    const t = await token();
    const res = await fetch(API + path, { method: "DELETE", headers: { Authorization: "Bearer " + t } });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  // ======== UI Header ========
  firebase.auth().onAuthStateChanged((u) => {
    el.whoami.textContent = u ? `Olá, ${u.email}` : "";
    if (!u) location.href = "./login.html";
  });

  el.logoutBtn.addEventListener("click", async () => {
    await firebase.auth().signOut();
    location.href = "./login.html";
  });

  // ======== Upload & Wipe (stubs) ========
  el.sendXlsxBtn.addEventListener("click", async () => {
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
      if (!res.ok) throw new Error(await res.text());
      alert("Upload concluído.");
      loadAll();
    } catch (e) {
      console.error(e);
      alert("Falha no upload: " + e.message);
    }
  });

  el.wipeBtn.addEventListener("click", async () => {
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
      const tbody = el.aliasTbody;
      if (!Array.isArray(data) || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="muted">Nenhum apelido cadastrado.</td></tr>`;
        return;
      }
      // suporta {alias, master} ou {dirty_name, master_name}
      tbody.innerHTML = data
        .map((a) => {
          const alias  = a.alias || a.dirty_name || a.dirty || "-";
          const master = a.master || a.master_name || a.nome_mestre || "-";
          const id     = a.id;
          return `<tr>
            <td>${alias}</td>
            <td>${master}</td>
            <td><button class="btn btn-outline" data-del="${id}">Excluir</button></td>
          </tr>`;
        })
        .join("");

      tbody.querySelectorAll("[data-del]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          try {
            await apiDelete(`/api/aliases/${btn.dataset.del}`);
            loadAliases();
          } catch (e) {
            alert("Erro ao excluir: " + e.message);
          }
        })
      );
    } catch (e) {
      el.aliasTbody.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar apelidos.</td></tr>`;
      console.error(e);
    }
  }

  el.aliasSaveBtn.addEventListener("click", async () => {
    const dirty = el.aliasDirty.value.trim();
    const master = el.aliasMaster.value.trim();
    if (!dirty || !master) return alert("Preencha os dois campos.");
    try {
      // aceita ambos os formatos no backend
      await apiPost("/api/aliases", { alias: dirty, master });
      el.aliasDirty.value = "";
      el.aliasMaster.value = "";
      loadAliases();
    } catch (e) {
      // fallback para a outra forma de payload
      try {
        await apiPost("/api/aliases", { dirty_name: dirty, master_name: master });
        el.aliasDirty.value = "";
        el.aliasMaster.value = "";
        loadAliases();
      } catch (err) {
        alert("Erro ao salvar: " + err.message);
      }
    }
  });

  // ======== Filtros, KPIs, Gráficos & Lista ========
  function readFilters() {
    return {
      companyId: el.filterCompany.value || "",
      booking: el.filterBooking.value.trim(),
      container: el.filterContainer.value.trim(),
      start: el.filterStart.value || "",
      end: el.filterEnd.value || "",
    };
  }

  async function loadCompaniesIntoFilter() {
    try {
      const list = await apiGet("/api/dashboard/companies");
      el.filterCompany.innerHTML = `<option value="">Todos Embarcadores</option>` +
        (list || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    } catch (e) {
      console.warn("companies:", e.message);
    }
  }

  // helper para construir gráficos horizontais
  function makeHorizontalBar(ctx, labels, values, label) {
    return new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label, data: values, borderWidth: 1 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",                    // <<< eixo X = valores
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { autoSkip: false } }
        },
        plugins: { legend: { display: true } }
      }
    });
  }

  async function loadKpisAndCharts() {
    const f = readFilters();
    try {
      const k = await apiGet("/api/dashboard/kpis", f);
      el.kpiTotal.textContent = k.total || 0;
      el.kpiOnTime.textContent = k.onTime || 0;
      el.kpiLate.textContent = k.late || 0;
      el.kpiPct.textContent = (k.latePct ?? 0) + "%";

      // charts (offenders / clients) — HORIZONTAIS
      const ctx1 = el.offendersChart.getContext("2d");
      const ctx2 = el.clientsChart.getContext("2d");
      charts.offenders?.destroy();
      charts.clients?.destroy();

      const offenders = k.topOffenders || [];
      const clients   = k.topClients   || [];

      charts.offenders = makeHorizontalBar(
        ctx1,
        offenders.map(x => x.reason),
        offenders.map(x => x.count),
        "Ocorrências"
      );

      charts.clients = makeHorizontalBar(
        ctx2,
        clients.map(x => x.client),
        clients.map(x => x.count),
        "Atrasos"
      );
    } catch (e) {
      console.error(e);
      el.kpiTotal.textContent = "0";
      el.kpiOnTime.textContent = "0";
      el.kpiLate.textContent = "0";
      el.kpiPct.textContent = "0%";
    }
  }

  function opRow(o) {
    return `<tr>
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
    <tr>
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

  async function loadOperations() {
    const f = readFilters();
    try {
      const data = await apiGet("/api/dashboard/operations", f);
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) {
        el.opsArea.innerHTML = `<div class="muted">Nenhuma operação encontrada.</div>`;
        return;
      }
      el.opsArea.innerHTML = `
        <div style="overflow:auto">
          <table class="table">
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
    } catch (e) {
      console.error(e);
      el.opsArea.innerHTML = `<div class="muted">Falha ao carregar operações.</div>`;
    }
  }

  // ======== Pendentes (opcional) ========
  async function loadPendingUsers() {
    try {
      const x = await apiGet("/api/dashboard/pending-users");
      el.pendingUsers.textContent = Array.isArray(x) && x.length ? `${x.length} pendentes` : "—";
    } catch (e) {
      el.pendingUsers.textContent = "—";
    }
  }

  // ======== KPIs clicáveis: navega para a lista filtrada ========
  function navigateToList(status) {
    const f = readFilters();
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);               // onTime | late | all
    if (f.booking) qs.set("booking", f.booking);
    if (f.container) qs.set("container", f.container);
    if (f.companyId) qs.set("companyId", f.companyId);
    if (f.start) qs.set("start", f.start);
    if (f.end) qs.set("end", f.end);
    window.location.href = `${LIST_PAGE_PATH}?${qs.toString()}`;
  }
  // Se os KPIs forem spans dentro de cards, capturamos o click no próprio span:
  el.kpiTotal?.addEventListener("click", () => navigateToList("all"));
  el.kpiOnTime?.addEventListener("click", () => navigateToList("onTime"));
  el.kpiLate?.addEventListener("click", () => navigateToList("late"));
  // Se houver elementos com data-filter (compatibilidade):
  document.querySelectorAll(".kpi-card[data-filter]").forEach(card => {
    card.addEventListener("click", () => navigateToList(card.dataset.filter));
  });

  // ======== Eventos dos filtros ========
  el.applyBtn.addEventListener("click", () => loadAll());
  el.clearBtn.addEventListener("click", () => {
    el.filterCompany.value = "";
    el.filterBooking.value = "";
    el.filterContainer.value = "";
    el.filterStart.value = "";
    el.filterEnd.value = "";
    loadAll();
  });

  // ======== Boot ========
  async function loadAll() {
    await Promise.all([
      loadKpisAndCharts(),
      loadOperations(),
      loadAliases(),
      loadPendingUsers(),
    ]);
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