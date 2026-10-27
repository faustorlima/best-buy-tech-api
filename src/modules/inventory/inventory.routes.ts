import { Router } from "express";
import { type Request, type Response } from "express";
import dotenv from "dotenv";
import { Pool } from "pg";
dotenv.config();

import {
  authenticateToken,
  type AuthRequest,
} from "../auth/middlewares/authMiddleware.js";
import { Console } from "console";

const router = Router();

// Aplica o middleware a TODAS as rotas declaradas abaixo deste ponto neste ficheiro
router.use(authenticateToken);

// Conexão direta com o banco de dados
const pool = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

// Exemplo de Payload esperado no req.body:
// {
//   "productId": 101,
//   "transactionType": "IN",
//   "orderNumber": "NF-12345",
//   "items": [
//     { "imeis": ["353456789012345", "353456789012346"] }, // Dual SIM
//     { "imeis": ["353456789012347"] } // Single SIM
//   ]
// }
// O bind HTTP acontece aqui
router.post(
  "/transactions",
  async (req: AuthRequest, res: Response): Promise<any> => {
    console.log("transactions req.body", req.body);

    const {
      productId,
      transactionOrigin,
      transactionType,
      orderNumber,
      imeis,
    } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingItem = await client.query(
        `SELECT   inventory_item_id
         FROM     public.inventory_items
         WHERE    product_id = $1 AND imeis = $2`,
        [productId, imeis],
      );

      let inventoryItemId = existingItem.rows[0]?.inventory_item_id || null;

      if (!inventoryItemId) {
        const itemResult = await client.query(
          `
        INSERT INTO public.inventory_items (product_id, status, imeis)
        VALUES ($1, $2, $3)
        ON CONFLICT (product_id, imeis)
        DO UPDATE SET status = EXCLUDED.status
        RETURNING inventory_item_id;
      `,
          [
            productId,
            transactionType === "IN" ? "Disponível" : "Vendido/Sem Estoque", // Ajusta o status baseando na transação
            imeis,
          ],
        );

        inventoryItemId = itemResult.rows[0].inventory_item_id;
      } else if (transactionType == "OUT") {
        const updateItem = await client.query(
          `UPDATE   public.inventory_items
           set      status = 'Vendido/Sem Estoque'
           WHERE    inventory_Item_Id = $1`,
          [inventoryItemId],
        );
      }

      // 3. Inserir a Movimentação vinculada ao Aparelho Físico
      const transResult = await client.query(
        `
        INSERT INTO public.inventory_transactions
          (product_id, inventory_item_id, quantity, transaction_type, order_number, transaction_origin)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING inventory_transaction_id;
      `,
        [
          productId,
          inventoryItemId,
          1, // Cada registro de transação agora representa 1 aparelho físico
          transactionType,
          orderNumber,
          transactionOrigin,
        ],
      );

      const transactionId = transResult.rows[0].inventory_transaction_id;

      let quantityToUpdate = 1;
      if (transactionType == "OUT") quantityToUpdate = -1;

      await client.query(
        `
      INSERT INTO public.inventory (product_id, quantity)
      VALUES ($1, $2)
      ON CONFLICT (product_id)
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
    `,
        [productId, quantityToUpdate],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Estoque atualizado com sucesso",
        transactionId,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro de integridade na transação de estoque:", error);
      return res
        .status(500)
        .json({ error: "Falha ao processar movimentação de estoque" });
    } finally {
      client.release();
    }
  },
);

router.get("/", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    // 1. Extrai search, page e limit da query string (com valores padrão caso não sejam enviados)
    let { search, page = "1", limit = "10" } = req.query;

    search = String(search).trim();
    // Converte para número inteiro
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    // Calcula o deslocamento (offset) para o SQL
    const offset = (pageNumber - 1) * limitNumber;

    // 2. Base da query SQL para buscar os dados
    let query = `
      select	p.product_id as "productId",
              i.inventory_id  as "inventoryId",
              p.bar_code as "barCode",
              p.model_sku as "modelSku",
              p.image_url as "imageUrl",
              p.imei_count as "imeiCount",
              i.quantity
      from	inventory i
      inner	join products p on i.product_id = p.product_id
      where	p.is_deleted = false
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    // 3. Condição de busca (opcional)
    if (search) {
      query += ` AND p.bar_code ILIKE $${paramIndex} OR p.model_sku ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 4. Adiciona Ordenação, Limite e Offset para a paginação
    // (Ex: ORDER BY id DESC para mostrar os mais recentes primeiro)
    query += ` ORDER BY p.model_sku LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limitNumber, offset);

    // 5. Executa a query principal
    const result = await pool.query(query, queryParams);

    // 6. (Opcional mas recomendado) Busca o total de registros para o Front-end saber quantas páginas existem
    let countQuery =
      "SELECT COUNT(*) from	inventory i inner	join products p on i.product_id = p.product_id ";
    const countParams: any[] = [];

    if (search) {
      countQuery += " WHERE bar_code ILIKE $1 OR model_sku ILIKE $1";
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    1;
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNumber);

    console.log(result.rows);

    // 7. Retorna os dados junto com os metadados de paginação
    return res.json({
      data: result.rows,
      pagination: {
        currentPage: pageNumber,
        perPage: limitNumber,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

router.get("/items", async (req: AuthRequest, res: Response): Promise<any> => {
  let { productId, page = "1", limit = "10" } = req.query;
  const pageNumber = parseInt(page as string, 10);
  const limitNumber = parseInt(limit as string, 10);

  let query = `
    SELECT  p.product_id as "productId",
            p.bar_code as "barCode",
            p.model_sku as "modelSku",
            ii.status,
            array_to_string(imeis, ',') as imeis,
            ii.created_at as "createdAt"
    FROM    inventory_items ii
    INNER   JOIN products p ON ii.product_id = p.product_id
    where 	p.product_id = $1
  `;

  const result = await pool.query(query, [productId]);

  // 4. Adiciona Ordenação, Limite e Offset para a paginação
  // (Ex: ORDER BY id DESC para mostrar os mais recentes primeiro)
  query += " ORDER BY p.model_sku LIMIT $2 OFFSET $3";

  // 6. (Opcional mas recomendado) Busca o total de registros para o Front-end saber quantas páginas existem
  let countQuery =
    "SELECT COUNT(*) from	inventory_items ii WHERE product_id = $1";
  const countResult = await pool.query(countQuery, [productId]);

  const totalItems = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalItems / limitNumber);

  return res.json({
    data: result.rows,
    pagination: {
      currentPage: pageNumber,
      perPage: limitNumber,
      totalItems,
      totalPages,
    },
  });
});

router.get(
  "/transactions",
  async (req: AuthRequest, res: Response): Promise<any> => {
    let { productId, page = "1", limit = "10" } = req.query;
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    let query = `
    SELECT  p.product_id as "productId",
            p.bar_code as "barCode",
            p.model_sku as "modelSku",
            it.quantity,
            it.order_number as "orderNumber",
            it.transaction_origin as "transactionOrigin",
            it.transaction_type as "transactionType",
            it.created_at as "createdAt",
            ii.imeis
    FROM    inventory_transactions it
    INNER   JOIN products p ON it.product_id = p.product_id
    INNER   JOIN inventory_items ii ON it.inventory_item_id = ii.inventory_item_id
    where 	p.product_id = $1
  `;

    const result = await pool.query(query, [productId]);

    // 4. Adiciona Ordenação, Limite e Offset para a paginação
    // (Ex: ORDER BY id DESC para mostrar os mais recentes primeiro)
    query += " ORDER BY p.model_sku LIMIT $2 OFFSET $3";

    // 6. (Opcional mas recomendado) Busca o total de registros para o Front-end saber quantas páginas existem
    let countQuery =
      "SELECT COUNT(*) from	inventory_items ii WHERE product_id = $1";
    const countResult = await pool.query(countQuery, [productId]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNumber);

    return res.json({
      data: result.rows,
      pagination: {
        currentPage: pageNumber,
        perPage: limitNumber,
        totalItems,
        totalPages,
      },
    });
  },
);
export default router;
