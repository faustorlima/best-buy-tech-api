import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// Estende a interface Request para transportar o ID do utilizador
export interface AuthRequest extends Request {
  userId?: number;
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Extrai do "Bearer TOKEN"

  if (!token) {
    return res
      .status(401)
      .json({ error: "Acesso negado. Token não fornecido." });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || "BBT_JWT_SECRET";
    const decoded = jwt.verify(token, jwtSecret) as { userId: number };

    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(403).json({ error: "Token inválido ou expirado." });
  }
};
