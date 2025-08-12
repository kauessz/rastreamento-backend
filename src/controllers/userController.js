// src/controllers/userController.js

const db = require('../config/database'); // Importa nossa conexão com o banco

// Função para registrar um novo usuário
exports.registerUser = async (req, res) => {
  const { firebase_uid, nome, email, nome_empresa } = req.body;

  // Validação simples para garantir que os dados necessários foram enviados
  if (!firebase_uid || !nome || !email || !nome_empresa) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  // Usamos um 'bloco de transação' para garantir a consistência dos dados.
  // Ou tudo funciona, ou nada é salvo.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN'); // Inicia a transação

    // Passo 1: Verificar se o embarcador já existe. Se não, criar um.
    let embarcadorResult = await client.query('SELECT id FROM embarcadores WHERE nome_principal = $1', [nome_empresa]);
    let embarcadorId;

    if (embarcadorResult.rows.length === 0) {
      // Se não existe, cria um novo embarcador
      const newEmbarcadorResult = await client.query(
        'INSERT INTO embarcadores (nome_principal) VALUES ($1) RETURNING id',
        [nome_empresa]
      );
      embarcadorId = newEmbarcadorResult.rows[0].id;
    } else {
      // Se já existe, pega o ID dele
      embarcadorId = embarcadorResult.rows[0].id;
    }

    // Passo 2: Inserir o novo usuário na tabela 'usuarios'
    const newUserQuery = `
      INSERT INTO usuarios (firebase_uid, nome, email, role, status, embarcador_id)
      VALUES ($1, $2, $3, 'embarcador', 'pendente', $4)
      RETURNING id, nome, email, status;
    `;
    const values = [firebase_uid, nome, email, embarcadorId];
    const newUserResult = await client.query(newUserQuery, values);

    await client.query('COMMIT'); // Se tudo deu certo, confirma as operações no banco

    res.status(201).json({
      message: 'Usuário registrado com sucesso! Aguardando aprovação do administrador.',
      user: newUserResult.rows[0],
    });

  } catch (error) {
    await client.query('ROLLBACK'); // Se algo deu errado, desfaz tudo
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  } finally {
    client.release(); // Libera a conexão com o banco de dados
  }
};

// Adicione no final do arquivo src/controllers/userController.js

// Função para listar todos os usuários com status 'pendente'
exports.getPendingUsers = async (req, res) => {
  try {
    const { rows } = await db.query("SELECT id, nome, email, status FROM usuarios WHERE status = 'pendente' ORDER BY data_criacao ASC");
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erro ao buscar usuários pendentes:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// Função para aprovar um usuário, mudando seu status para 'ativo'
exports.approveUser = async (req, res) => {
  const { id } = req.params; // Pega o ID do usuário da URL (ex: /approve/1)

  try {
    const { rows } = await db.query(
      "UPDATE usuarios SET status = 'ativo' WHERE id = $1 RETURNING id, nome, status",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    res.status(200).json({
      message: 'Usuário aprovado com sucesso!',
      user: rows[0],
    });
  } catch (error) {
    console.error('Erro ao aprovar usuário:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

exports.getCurrentUserProfile = async (req, res) => {
  try {
    // req.user.uid é adicionado pelo nosso authMiddleware
    const firebase_uid = req.user.uid;
    const { rows } = await db.query(
      'SELECT nome, email, role, status FROM usuarios WHERE firebase_uid = $1',
      [firebase_uid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Perfil de usuário não encontrado no nosso sistema.' });
    }
    
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error("Erro ao buscar perfil do usuário:", error);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
};