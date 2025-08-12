// src/config/multerConfig.js
const multer = require('multer');
const path = require('path');

// Configura onde os arquivos temporários serão armazenados
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Salva na pasta 'uploads' na raiz do projeto
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Nome do arquivo único
  }
});

const upload = multer({ storage: storage });

module.exports = upload;