const admin = require('firebase-admin');
require('dotenv').config();

// Tratamento da chave privada que vem do .env
const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
  console.log('Firebase Admin SDK inicializado com sucesso.');
} catch (error) {
  console.error('Erro ao inicializar o Firebase Admin SDK:', error);
}

module.exports = admin;