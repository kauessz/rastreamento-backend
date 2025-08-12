// frontend/js/firebase-init.js

const firebaseConfig = {
    apiKey: "AIzaSyAhC_i0QzbwnO6FEJxPobPyhDf4u4PjeoQ",
    authDomain: "tracking-17303.firebaseapp.com",
    projectId: "tracking-17303",
    storageBucket: "tracking-17303.firebasestorage.app",
    messagingSenderId: "457194760098",
    appId: "1:457194760098:web:342b6c25b46f38b01af4fb"
  };

// Inicializa o aplicativo Firebase com as suas configurações.
// Esta é a porta de entrada para todos os serviços do Firebase.
const app = firebase.initializeApp(firebaseConfig);

// Exporta o serviço de autenticação do Firebase.
// Nós vamos importar esta variável 'auth' em outros arquivos para usar as funções de login e registro.
const auth = firebase.auth();