// frontend/js/login.js
document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.API_BASE || 'https://rastreamento-backend-05pi.onrender.com';

  const loginForm = document.getElementById('loginForm');
  const messageElement = document.getElementById('message');

  function showMsg(text, color = 'gray') {
    messageElement.textContent = text;
    messageElement.style.color = color;
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    showMsg('Entrando...', 'gray');

    try {
      // 1) Login Firebase
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // 2) ID Token p/ backend
      const idToken = await user.getIdToken(true);

      // Guarda (para outros fetches no front)
      try {
        localStorage.setItem('idToken', idToken);
        sessionStorage.setItem('idToken', idToken);
      } catch (_) {}

      console.log('projectId(front):', firebase.app().options.projectId);
      console.log('idToken prefix:', (idToken || '').slice(0, 14));

      // 3) Perfil no backend
      const resp = await fetch(`${API_BASE}/api/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          // não precisa enviar Content-Type no GET
        }
      });

      const raw = await resp.text(); // parse robusto
      let profile;
      try {
        profile = JSON.parse(raw);
      } catch {
        throw new Error(`Resposta inesperada do servidor (${resp.status}).`);
      }
      if (!resp.ok) {
        throw new Error(profile?.message || profile?.error || `Falha (${resp.status})`);
      }

      // 4) Decisão: admin (dashboard) ou cliente (client-dashboard)
      const isAdmin = !!(profile.admin === true || profile.role === 'admin');

      if (isAdmin) {
        showMsg('Login como Admin bem-sucedido! Redirecionando...', 'green');
        setTimeout(() => (window.location.href = 'dashboard.html'), 300);
      } else {
        // se quiser bloquear por status, adicione: if (profile.status !== 'ativo') { throw new Error(...) }
        showMsg('Login bem-sucedido! Redirecionando...', 'green');
        setTimeout(() => (window.location.href = 'client-dashboard.html'), 300);
      }

    } catch (error) {
      console.error('Erro no login:', error);
      showMsg(`Erro: ${error.message}`, 'red');
    }
  });
});