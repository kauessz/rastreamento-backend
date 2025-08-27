(() => {
  // Base do backend (vem do HTML, mas deixo fallback)
  const API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";

  // Helpers DOM
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  function log(msg) { if (logEl) logEl.textContent = msg; }

  // Preenche datas padrão (últimos 30 dias) e companyId 0
  (function setDefaults() {
    const end = new Date();
    const start = new Date(Date.now() - 30 * 864e5);
    if ($('start')) $('start').value = start.toISOString().slice(0, 10);
    if ($('end')) $('end').value = end.toISOString().slice(0, 10);
    if ($('companyId')) $('companyId').value = 0;
  })();

  // Estado de auth
  let currentToken = null;

  // Firebase Auth → token
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    try {
      currentToken = await user.getIdToken(true);
      log(`Autenticado como ${user.email}.`);
    } catch (e) {
      console.error(e);
      alert('Falha ao obter token. Faça login novamente.');
      window.location.href = 'login.html';
    }
  });

  // Logout
  $('btnLogout')?.addEventListener('click', () => firebase.auth().signOut());

  // ===== Download helper (GET com Authorization) =====
  async function download(path, params, fallbackName) {
    if (!currentToken) { alert('Aguardando autenticação…'); return; }
    const q = new URLSearchParams(params || {});
    const url = `${API_BASE_URL}${path}?${q.toString()}`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${currentToken}` } });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} — ${t}`);
    }

    const blob = await resp.blob();
    // tenta extrair filename do header
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : fallbackName || 'download';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  // ===== Botões "relatórios rápidos" (rotas antigas) =====
  $('btnPdf')?.addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end   = $('end').value   || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando PDF…');
    try {
      await download('/api/reports/daily', { start, end, companyId }, `diario_${start}_a_${end}.pdf`);
      log('PDF gerado ✅');
    } catch (e) { console.error(e); log('Falha ao gerar PDF. Veja o console.'); }
  });

  $('btnTop')?.addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end   = $('end').value   || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Top 10)…');
    try {
      await download('/api/reports/top-ofensores.xlsx', { start, end, companyId }, `top_ofensores_${start}_a_${end}.xlsx`);
      log('Excel (Top 10) gerado ✅');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Top 10).'); }
  });

  $('btnAtrasos')?.addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end   = $('end').value   || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Atrasos)…');
    try {
      await download('/api/reports/atrasos.xlsx', { start, end, companyId }, `resumo_atrasos_${start}_a_${end}.xlsx`);
      // opcional: dispara e-mail aos clientes após gerar o arquivo
      await fetch(`${API_BASE_URL}/api/reports/atrasos/send-emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ start, end, companyId })
      });
      log('Excel (Atrasos) gerado e e-mails enviados ✅');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Atrasos).'); }
  });

  // ===== Mini-IA: entende “... do cliente AMBEV”, pede 2 planilhas e gera PDF =====
  function extractCliente(text) {
    const t = (text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[“”"']/g, '')
      .trim();

    // pegar após “cliente|embarcador …”
    let m = t.match(/(?:cliente|embarcador)\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();

    // fallback: pegar após “do|da|de|para …”
    m = t.match(/(?:do|da|de|para)\s+(.+?)$/i);
    if (m && m[1] && !/periodo|de\s+\d{4}/.test(m[1])) return m[1].trim();

    return '';
  }

  $('btnCmd')?.addEventListener('click', async () => {
    const frase = $('cmd').value || '';
    const cliente = extractCliente(frase);
    if (!/di[aá]rio\s+de\s+bordo/i.test(frase) || !cliente) {
      alert('Ex.: "enviar diário de bordo do cliente AMBEV"');
      return;
    }

    log(`Gerando Diário de Bordo para "${cliente.toUpperCase()}". Selecione as duas planilhas…`);

    // pede as duas planilhas
    const pick = (inputId) => new Promise((res) => { const el = $(inputId); el.onchange = () => res(el.files[0]); el.click(); });
    const [fonte, informacoes] = await Promise.all([pick('fileFonte'), pick('fileInfo')]);

    if (!fonte || !informacoes) { alert('Envie as duas planilhas.'); return; }
    if (!currentToken) { alert('Sem token. Faça login novamente.'); return; }

    const start = $('start').value || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const end   = $('end').value   || new Date().toISOString().slice(0, 10);
    const companyId = Number($('companyId').value || 0);

    const form = new FormData();
    form.append('cliente', cliente);            // agora vai só o nome (ex.: "ambev")
    form.append('companyId', String(companyId));
    form.append('start', start);
    form.append('end', end);
    form.append('fonte', fonte);
    form.append('informacoes', informacoes);

    log('Enviando planilhas…');
    const resp = await fetch(`${API_BASE_URL}/api/reports/diario-de-bordo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentToken}` },
      body: form
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('Erro diário:', txt);
      log(`Falha ao gerar Diário: ${txt || resp.status}`);
      return;
    }

    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diario_de_bordo_${cliente}_${start}_a_${end}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);

    log('Diário de Bordo gerado ✅');
  });

  // ===== Tema claro/escuro (corrigido: agora inicializa de fato) =====
  (function themeBoot() {
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
      localStorage.setItem('theme', mode);
    }
  })();

})(); 