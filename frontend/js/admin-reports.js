(() => {
  const API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');

  function log(msg) { logEl.textContent = msg; }

  // datas padrão (últimos 30 dias)
  const end = new Date();
  const start = new Date(Date.now() - 30 * 864e5);
  $('start').value = start.toISOString().slice(0, 10);
  $('end').value = end.toISOString().slice(0, 10);
  $('companyId').value = 0;

  let currentToken = null;

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    try {
      currentToken = await user.getIdToken(/* forceRefresh? */ true);
      log(`Autenticado como ${user.email}.`);
    } catch (e) {
      console.error(e);
      alert('Falha ao obter token. Faça login novamente.');
      window.location.href = 'login.html';
    }
  });

  $('btnLogout').addEventListener('click', () => firebase.auth().signOut());

  // util: baixa um GET como arquivo usando fetch + Authorization header
  async function download(path, params, fallbackName) {
    if (!currentToken) { alert('Aguardando autenticação…'); return; }
    const q = new URLSearchParams(params);
    const url = `${API_BASE_URL}${path}?${q.toString()}`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${currentToken}` } });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} — ${t}`);
    }
    const blob = await resp.blob();
    // tenta extrair nome do header
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : fallbackName;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('btnPdf').addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end = $('end').value || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando PDF…');
    try {
      await download('/api/reports/daily', { start, end, companyId }, `diario_${start}_a_${end}.pdf`);
      log('PDF gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar PDF. Veja o console.'); }
  });

  $('btnTop').addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end = $('end').value || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Top 10)…');
    try {
      await download('/api/reports/top-ofensores.xlsx', { start, end, companyId }, `top_ofensores_${start}_a_${end}.xlsx`);
      log('Excel (Top 10) gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Top 10).'); }
  });

  $('btnAtrasos').addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end = $('end').value || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Atrasos)…');
    try {
      await download('/api/reports/atrasos.xlsx', { start, end, companyId }, `resumo_atrasos_${start}_a_${end}.xlsx`);
      log('Excel (Atrasos) gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Atrasos).'); }
  });

  // ===== Mini-IA de comandos =====
  function parseCmd(text) {
    const t = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // ex.: "me envie o diario de bordo do cliente totalplast"
    const m = /diario\s+de\s+bordo.*cliente\s+(.+)/i.exec(t);
    if (m) return { kind: 'diario', cliente: m[1].trim() };
    return null;
  }

  $('btnCmd').addEventListener('click', async () => {
    const cmd = parseCmd($('cmd').value);
    if (!cmd) { alert('Não entendi. Tente: "me envie o diário de bordo do cliente X"'); return; }

    if (cmd.kind === 'diario') {
      // pede os 2 arquivos
      log('Selecione as duas planilhas (fonte de dados e informações de transporte)…');

      const p1 = new Promise((res) => { const i = $('fileFonte'); i.onchange = () => res(i.files[0]); i.click(); });
      const p2 = new Promise((res) => { const i = $('fileInfo'); i.onchange = () => res(i.files[0]); i.click(); });

      const [fonte, informacoes] = await Promise.all([p1, p2]);
      if (!fonte || !informacoes) { alert('Envie as duas planilhas.'); return; }

      if (!currentToken) { alert('Aguardando autenticação…'); return; }

      const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const end = $('end').value || new Date().toISOString().slice(0, 10);
      const companyId = Number($('companyId').value || 0);

      const form = new FormData();
      form.append('cliente', $('cmd').value); // manda a frase original
      form.append('companyId', String(companyId));
      form.append('start', start);
      form.append('end', end);
      form.append('fonte', fonte);
      form.append('informacoes', informacoes);

      log('Gerando Diário de Bordo (PDF)…');
      const resp = await fetch(`${API_BASE_URL}/api/reports/diario-de-bordo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
        body: form
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        console.error(err);
        return log('Falha ao gerar Diário. Veja o console.');
      }

      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `diario_de_bordo_${start}_a_${end}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);

      log('Diário de Bordo gerado ✅');
    }
  });

  // Dispara email automaticamente após gerar "Atrasos"
  document.getElementById('btnAtrasos').addEventListener('click', async () => {
    // depois que baixar o Excel, pede para backend enviar e-mails
    try {
      const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const end = $('end').value || new Date().toISOString().slice(0, 10);
      const companyId = Number($('companyId').value || 0);
      await fetch(`${API_BASE_URL}/api/reports/atrasos/send-emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ start, end, companyId })
      });
      log('Resumo de atrasos gerado e e-mails enviados ✅');
    } catch (e) {
      console.error(e);
      log('Falha ao enviar e-mails de atrasos.');
    }
  }, { once: false });

  // ===== Tema claro/escuro =====
  (function () {
    const root = document.documentElement;
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = saved || (prefersDark ? 'dark' : 'light');
    setTheme(initial);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', () => {
      const next = root.classList.contains('dark') ? 'light' : 'dark';
      setTheme(next);
    });

    function setTheme(mode) {
      root.classList.toggle('dark', mode === 'dark');
      root.dataset.theme = mode;              // caso seu CSS use [data-theme="dark"]
      localStorage.setItem('theme', mode);
    }
  });

  })();