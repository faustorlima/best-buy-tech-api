import express, { type Request, type Response, Router } from "express";
import {
  authenticateToken,
  type AuthRequest,
} from "../auth/middlewares/authMiddleware.js";
import { Pool } from "pg";

const router = Router();

// Aplica o middleware a TODAS as rotas declaradas abaixo deste ponto neste ficheiro
router.use(authenticateToken);

// Conexão direta com o banco de dados
const pool = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});
