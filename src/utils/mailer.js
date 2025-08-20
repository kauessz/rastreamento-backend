// src/utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, html, attachments = [] }) {
  const from = process.env.REPORT_FROM || 'no-reply@example.com';
  const info = await transporter.sendMail({ from, to, subject, html, attachments });
  return info;
}

module.exports = { sendMail };