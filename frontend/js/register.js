// frontend/js/register.js
document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');
    const messageElement = document.getElementById('message');

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const name = document.getElementById('name').value;
        const company = document.getElementById('company').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        messageElement.textContent = 'Registrando...';
        messageElement.style.color = 'gray';

        try {
            // 1. Usa o SDK do Firebase para criar um novo usuário
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const firebaseUser = userCredential.user;

            // 2. Se deu certo, envia os dados para a nossa API Node.js
            const response = await fetch('http://localhost:3001/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firebase_uid: firebaseUser.uid,
                    nome: name,
                    email: email,
                    nome_empresa: company,
                }),
            });

            const data = await response.json();
            if (!response.ok) { throw new Error(data.message); }

            messageElement.textContent = 'Registro enviado com sucesso! Redirecionando para o login...';
            messageElement.style.color = 'green';
            setTimeout(() => { window.location.href = 'login.html'; }, 2000);

        } catch (error) {
            console.error('Erro no registro:', error);
            messageElement.textContent = `Erro: ${error.message}`;
            messageElement.style.color = 'red';
        }
    });
});