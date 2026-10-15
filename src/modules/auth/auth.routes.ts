import express, { type Request, type Response, Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const router = Router();

// Conexão direta com o banco de dados
const pool = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

router.post("/", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha são obrigatórios." });
  }

  const hashPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  try {
    // 1. Busca o usuário no banco de dados usando a tabela accounts
    const query =
      "SELECT user_id, email, password_hash FROM accounts WHERE email = $1 and password_hash = $2";
    const { rows } = await pool.query(query, [email, hashPassword]);
    const user = rows[0];

    // Se o usuário não existir, retorna erro genérico por segurança
    if (!user) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    // 3. Gera o JWT contendo o user_id no payload
    const jwtSecret = process.env.JWT_SECRET || "BBT_JWT_SECRET";
    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      jwtSecret,
      { expiresIn: "2h" }, // Define a expiração do token
    );

    // 4. Retorna o token para o cliente
    return res.json({
      message: "Login realizado com sucesso",
      token,
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
});

export default router;
