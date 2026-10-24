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

router.get("/", async (req: AuthRequest, res) => {
  let query = `
    SELECT  s.store_id  AS "storeId",
            external_id AS "storeExternalId",
            s."name"    AS "storeName",
            ic."name"   AS "integrationChannelName"
    FROM   stores s
        INNER JOIN integration_channels ic
            ON s.integration_channel_id = ic.integration_channel_id
    ORDER  BY 4,
            3
    `;

  try {
    const result = await pool.query(query);

    // 7. Retorna os dados junto com os metadados de paginação
    return res.json(result.rows);
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      error: "Erro ao buscar lojas",
      query: query
        .replace(/\\r\\n|\\n|\\r|\\t/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
});

export default router;
