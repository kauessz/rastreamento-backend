// Em: frontend/js/login.js (substitua tudo)
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const messageElement = document.getElementById('message');

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        messageElement.textContent = 'Entrando...';
        messageElement.style.color = 'gray';

        try {
            // 1. Faz o login no Firebase
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // 2. Pega o token para se comunicar com nossa API
            const idToken = await user.getIdToken();

            // 3. Pergunta para a nossa API: "Quem é este usuário?"
            const response = await fetch('http://localhost:3001/api/users/me', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            const profile = await response.json();
            if (!response.ok) { throw new Error(profile.message); }

            // 4. Decide para onde redirecionar com base na resposta da API
            if (profile.role === 'admin') {
                messageElement.textContent = 'Login como Admin bem-sucedido! Redirecionando...';
                messageElement.style.color = 'green';
                window.location.href = 'dashboard.html';
            } else if (profile.role === 'embarcador') {
                if (profile.status === 'ativo') {
                    messageElement.textContent = 'Login bem-sucedido! Redirecionando...';
                    messageElement.style.color = 'green';
                    window.location.href = 'client-dashboard.html'; // <-- A NOVA PÁGINA DO CLIENTE
                } else {
                    // Se o status for 'pendente'
                    throw new Error('Sua conta ainda está aguardando aprovação do administrador.');
                }
            } else {
                throw new Error('Tipo de usuário desconhecido.');
            }

        } catch (error) {
            console.error('Erro no login:', error);
            messageElement.textContent = `Erro: ${error.message}`;
            messageElement.style.color = 'red';
        }
    });
});