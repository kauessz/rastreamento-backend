(() => {
  const API_BASE_URL = window.API_BASE_URL || "https://rastreamento-backend-05pi.onrender.com";
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');

  function log(msg) { logEl.textContent = msg; }

  // datas padrão (últimos 30 dias)
  const end = new Date();
  const start = new Date(Date.now() - 30*864e5);
  $('start').value = start.toISOString().slice(0,10);
  $('end').value = end.toISOString().slice(0,10);
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
      const t = await resp.text().catch(()=> '');
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
    const start = $('start').value || new Date(Date.now() - 30*864e5).toISOString().slice(0,10);
    const end = $('end').value || new Date().toISOString().slice(0,10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando PDF…');
    try {
      await download('/api/reports/daily', { start, end, companyId }, `diario_${start}_a_${end}.pdf`);
      log('PDF gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar PDF. Veja o console.'); }
  });

  $('btnTop').addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30*864e5).toISOString().slice(0,10);
    const end = $('end').value || new Date().toISOString().slice(0,10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Top 10)…');
    try {
      await download('/api/reports/top-ofensores.xlsx', { start, end, companyId }, `top_ofensores_${start}_a_${end}.xlsx`);
      log('Excel (Top 10) gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Top 10).'); }
  });

  $('btnAtrasos').addEventListener('click', async () => {
    const start = $('start').value || new Date(Date.now() - 30*864e5).toISOString().slice(0,10);
    const end = $('end').value || new Date().toISOString().slice(0,10);
    const companyId = Number($('companyId').value || 0);
    log('Gerando Excel (Atrasos)…');
    try {
      await download('/api/reports/atrasos.xlsx', { start, end, companyId }, `resumo_atrasos_${start}_a_${end}.xlsx`);
      log('Excel (Atrasos) gerado.');
    } catch (e) { console.error(e); log('Falha ao gerar Excel (Atrasos).'); }
  });
})();