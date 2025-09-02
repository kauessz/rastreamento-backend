// frontend/js/register.js
document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.API_BASE || 'https://rastreamento-backend-05pi.onrender.com';

  const registerForm = document.getElementById('registerForm');
  const messageElement = document.getElementById('message');

  function showMsg(text, color = 'gray') {
    messageElement.textContent = text;
    messageElement.style.color = color;
  }

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('name').value.trim();
    const company = document.getElementById('company').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    showMsg('Registrando...', 'gray');

    try {
      // 1) Cria usuário no Firebase
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const firebaseUser = userCredential.user;

      // 2) Token (se sua rota de registro exigir verificação)
      const idToken = await firebaseUser.getIdToken(true);

      // 3) Envia p/ backend (registro pendente/aprovação)
      const resp = await fetch(`${API_BASE}/api/users/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Se a rota for pública, o Authorization é opcional; se exigir, já está pronto:
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          firebase_uid: firebaseUser.uid,
          nome: name,
          email: email,
          nome_empresa: company
        })
      });

      const raw = await resp.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Resposta inesperada do servidor (${resp.status}).`);
      }
      if (!resp.ok) {
        throw new Error(data?.message || data?.error || `Falha (${resp.status})`);
      }

      showMsg('Registro enviado com sucesso! Redirecionando para o login...', 'green');
      setTimeout(() => { window.location.href = 'login.html'; }, 1500);

    } catch (error) {
      console.error('Erro no registro:', error);
      showMsg(`Erro: ${error.message}`, 'red');
    }
  });
});