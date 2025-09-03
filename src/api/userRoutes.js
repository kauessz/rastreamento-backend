// src/api/userRoutes.js
const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

function computeIsAdmin(decoded) {
  const email = (decoded.email || '').toLowerCase();

  const LIST = (process.env.ADMIN_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const DOMAINS = (process.env.ADMIN_DOMAINS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim().replace(/^@/, '')) // normaliza, aceita "@empresa.com" ou "empresa.com"
    .filter(Boolean);

  const viaClaim =
    decoded.admin === true ||
    decoded.role === 'admin' ||
    decoded.is_admin === true;

  const viaEmail  = LIST.includes(email);
  const viaDomain = email && DOMAINS.some(d => email.endsWith(`@${d}`));

  return Boolean(viaClaim || viaEmail || viaDomain);
}

async function verifyBearer(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!idToken) return res.status(401).json({ message: 'Não autorizado: Token não fornecido.' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Não autorizado: Token inválido.', detail: e.message });
  }
}

router.get('/me', verifyBearer, (req, res) => {
  const u = req.user || {};
  const isAdmin = computeIsAdmin(u);

  return res.json({
    uid: u.uid,
    email: u.email || null,
    name: u.name || u.displayName || null,
    admin: isAdmin
  });
});

module.exports = router;