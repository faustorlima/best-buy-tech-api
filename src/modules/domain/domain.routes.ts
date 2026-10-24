import { Router } from "express";
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

router.get("/orderStatuses", async (req: AuthRequest, res) => {
  const { provider } = req.query;

  console.log("provider", provider);
  let query = `
    SELECT  external_value as "code",
            CONCAT(provider, ' - ', internal_value) as "value",
            provider
    FROM    public.integration_mappings
    WHERE   domain = 'ORDER_STATUS'
    AND     (provider = $1 or $1 is null)
    ORDER   BY CONCAT(provider, ' - ', internal_value)
    `;

  try {
    const result = await pool.query(query, [provider || null]);

    // 7. Retorna os dados junto com os metadados de paginação
    return res.json(result.rows);
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      error: "Erro ao buscar status",
      query: query
        .replace(/\\r\\n|\\n|\\r|\\t/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
});

export default router;
