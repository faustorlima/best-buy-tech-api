import { Router } from "express";
import { type Request, type Response } from "express";
import dotenv from "dotenv";
import { Pool } from "pg";
dotenv.config();

const PORT = process.env.PORT || 3000;

const router = Router();

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
  async (req: Request, res: Response): Promise<any> => {
    const { productId, transactionType, orderNumber, imeis } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const itemResult = await client.query(
        `
        INSERT INTO public.inventory_items (product_id, status)
        VALUES ($1, $2)
        RETURNING inventory_item_id;
      `,
        [
          productId,
          transactionType === "IN" ? "AVAILABLE" : "SOLD", // Ajusta o status baseando na transação
        ],
      );

      const inventoryItemId = itemResult.rows[0].inventory_item_id;

      // 2. Inserir os IMEIs vinculados ao ID do aparelho recém-criado
      await client.query(
        `
        INSERT INTO public.inventory_item_imeis (inventory_item_id, imei_number)
        SELECT $1, unnest($2::varchar[])
        ON CONFLICT (imei_number)
        DO UPDATE SET inventory_item_id = EXCLUDED.inventory_item_id;
      `,
        [inventoryItemId, imeis],
      );

      // 3. Inserir a Movimentação vinculada ao Aparelho Físico
      const transResult = await client.query(
        `
        INSERT INTO public.inventory_transactions
          (product_id, inventory_item_id, quantity, transaction_type, order_number)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING inventory_transaction_id;
      `,
        [
          productId,
          inventoryItemId,
          1, // Cada registro de transação agora representa 1 aparelho físico
          transactionType,
          orderNumber,
        ],
      );

      const transactionId = transResult.rows[0].inventory_transaction_id;

      // PASSO B: Atualizar o Estoque Absoluto (Visão Agregada)
      // Se a transação for de saída (OUT), o EXCLUDED.quantity deve ser negativo para subtrair
      const quantityToUpdate = 1;

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

export default router;
