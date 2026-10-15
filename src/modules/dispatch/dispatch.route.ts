import express from "express";
import { Router } from "express";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

import {
  authenticateToken,
  type AuthRequest,
} from "../auth/middlewares/authMiddleware.js";

const router = Router();

// Aplica o middleware a TODAS as rotas declaradas abaixo deste ponto neste ficheiro
router.use(authenticateToken);

// Conexão direta com o banco de dados
const pool = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

router.get("/:search", async (req: AuthRequest, res) => {
  // 1. Extrai search, page e limit da query string (com valores padrão caso não sejam enviados)
  let { search } = req.params;

  search = String(search).trim();

  // 2. Base da query SQL para buscar os dados
  let query = `

    SELECT	o.full_order_id as "orderId",
            o.order_number as "orderNumber",
            s."name"  as "storeName",
            ic.name as "integrationChannel",
            i.item_id as "itemId",
            i.full_order_item_id as "orderItemId",
            trim(i.model_sku) as "modelSku",
            cast(i.quantity as integer) as "quantity",
            p.bar_code as "barCode",
            p.imei_count as "imeiCount",
            p.image_url as "imageUrl",
            o.order_original_status as "orderStatus",
            dispatched_at AS "dispatchedAt",
            COALESCE(ARRAY_AGG(foii.imei) FILTER (WHERE foii.imei IS NOT NULL), '{}') AS "dispatchedImeis"
    FROM 	  full_orders o
    INNER   JOIN 	invoices inv ON o.order_number = inv.order_number and o.store_id = inv.store_id
    INNER   JOIN 	full_order_items i ON o.order_number = i.order_number
    INNER   JOIN 	stores s ON o.store_id = s.store_id
    INNER   JOIN 	integration_channels ic ON ic.integration_channel_id = o.integration_channel_id
    LEFT 	  JOIN products p ON trim(i.model_sku) = trim(p.model_sku)
    LEFT    JOIN full_order_item_imeis foii ON foii.full_order_item_id = i.full_order_item_id
    WHERE 	o.shipment_tracking_code = $1
    OR 		  inv.invoice_key = $1
    GROUP   BY  o.full_order_id,
                o.order_number,
                s.name,
                ic.name,
                i.item_id,
                i.full_order_item_id,
                i.model_sku,
                i.quantity,
                p.bar_code,
                p.imei_count,
                p.image_url,
                o.order_original_status,
              o.dispatched_at
    `;
  try {
    const result = await pool.query(query, [search]);

    // Caso o ID informado não exista no banco
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Pedido não encontrado" });
    }

    // Retorna o produto atualizado
    return res.status(200).json(result.rows);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

router.post("/", async (req: AuthRequest, res) => {
  const { orderId, items } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "orderId é obrigatório." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Atualiza dispatched_at na tabela full_orders usando full_order_id como chave
    await client.query(
      `
      UPDATE full_orders
      SET dispatched_at = NOW() AT TIME ZONE 'UTC'
      WHERE full_order_id = $1
      `,
      [orderId],
    );

    // 2. Insere os IMEIs na tabela full_order_item_imeis
    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (
          item.orderItemId &&
          Array.isArray(item.imeis) &&
          item.imeis.length > 0
        ) {
          for (const imei of item.imeis) {
            await client.query(
              `
              INSERT INTO full_order_item_imeis (full_order_item_id, imei)
              VALUES ($1, $2)
              `,
              [item.orderItemId, imei],
            );
          }
        }
      }
    }

    await client.query("COMMIT");
    return res
      .status(200)
      .json({ message: "Despacho registrado com sucesso." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao registrar despacho:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao registrar despacho." });
  } finally {
    client.release();
  }
});

export default router;
