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
  try {
    // 1. Extrai variáveis e converte paginação
    const {
      storeId,
      orderStartDate,
      orderEndDate,
      orderNumber,
      invoiceNFeId,
      invoiceStatus,
      orderStatus,
      page = "1",
      limit = "10",
    } = req.query;
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    console.log("orderStartDate", orderStartDate);
    console.log("orderEndDate", orderEndDate);

    // CORREÇÃO: Sintaxe de subtração corrigida
    const offset = (pageNumber - 1) * limitNumber;

    // 2. Base da query SQL
    let queryData = `
      select  fo.full_order_id as "orderId",
              fo.order_number  as "orderNumber",
              COALESCE(im.internal_value, fo.order_original_status) as "orderStatus",
              fo.order_status_date as "orderStatusDate",
              s."name" as "storeName",
              ic."name" as "platformName",
              i.invoice_number as "invoiceNumber",
              i.nf_status as "invoiceStatus",
              i.external_id as "invoiceExternalId",
              case
                when i.invoice_shopee_xml is not null then true
                else false
              end as "invoiceHasXML",
              i.error_details as "invoiceErrorDetails",
              i.invoice_key as "invoiceKey"
    `;

    // CORREÇÃO: Alterado "||" para "OR" e alterado "$3" para "$1"
    let queryFromAndFilter = `
      from  full_orders fo
      inner   join public.integration_channels ic on fo.integration_channel_id = ic.integration_channel_id
      inner   join public.stores s on fo.store_id = s.store_id
      left  join public.integration_mappings im on fo.order_original_status = im.external_value and im.provider = UPPER(ic.name) and im.domain = 'ORDER_STATUS'
      left  join invoices i on fo.order_number = i.order_number and fo.store_id = i.store_id
      where (fo.store_id = $1 OR $1 is null)
      and   (fo.order_payment_date >= $2 or $2 is null)
      and   (fo.order_payment_date <= $3 or $3 is null)
      and   (fo.order_number = $4 or $4 is null)
      and   (i.external_id = $5 or $5 is null)
      and   (i.nf_status = $6 or $6 is null)
      and   (fo.order_original_status  = $7 or $7 is null)
    `;

    // 4. Limite e offset ($2 = limit, $3 = offset)
    let queryPaging = ` ORDER BY fo.order_payment_date DESC LIMIT $8 OFFSET $9`;

    // Parâmetros da query principal
    const queryParams = [
      storeId || null,
      orderStartDate || null,
      orderEndDate || null,
      orderNumber || null,
      invoiceNFeId || null,
      invoiceStatus || null,
      orderStatus || null,
      limitNumber,
      offset,
    ];

    // Executa Query Principal
    let query = `${queryData} ${queryFromAndFilter} ${queryPaging}`;
    const result = await pool.query(query, queryParams);

    // CORREÇÃO: Parâmetros do count ajustados para corresponder ao $1
    let countQuery = "SELECT COUNT(*) " + queryFromAndFilter;
    const countParams = queryParams.slice(0, -2); // Passa apenas o que foi usado no queryFromAndFilter
    const countResult = await pool.query(countQuery, countParams);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNumber);

    // 7. Retorno
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
    return res.status(500).json({
      error: "Erro ao buscar pedidos",
    });
  }
});

router.get("/:orderId", async (req: AuthRequest, res) => {
  const { orderId } = req.params;

  const query = `
    select  fo.full_order_id as "orderId",
            fo.order_number  as "orderNumber",
            COALESCE(im.internal_value, fo.order_original_status) as "orderStatus",
            fo.order_status_date as "orderStatusDate",
            s."name" as "storeName",
            ic."name" as "platformName",
            i.invoice_number as "invoiceNumber",
            i.nf_status as "invoiceStatus",
            i.external_id as "invoiceExternalId",
            case
              when i.invoice_shopee_xml is not null then true
              else false
            end as "invoiceHasXML",
            i.error_details as "invoiceErrorDetails",
            i.invoice_key as "invoiceKey"
    from    full_orders fo
    inner   join public.integration_channels ic on fo.integration_channel_id = ic.integration_channel_id
    inner   join public.stores s on fo.store_id = s.store_id
    left    join public.integration_mappings im on fo.order_original_status = im.external_value and im.provider = UPPER(ic.name) and im.domain = 'ORDER_STATUS'
    left    join invoices i on fo.order_number = i.order_number and fo.store_id = i.store_id
    where   fo.full_order_id = $1
  `;

  try {
    const result = await pool.query(query, [orderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar pedido", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao processar a solicitação." });
  }
});

router.get("/:orderId/steps", async (req: AuthRequest, res) => {
  const { orderId } = req.params;

  const query = `

  WITH order_invoice AS (
    -- Centraliza a busca da invoice, evitando consultar a mesma tabela duas vezes
    SELECT i.invoice_number, i.created_at, i.invoice_key, fo.store_id, fo.order_number
    FROM full_orders fo
    left	join invoices i on i.store_id = fo.store_id and i.order_number = fo.order_number
    where fo.full_order_id = $1
)
SELECT im.step_name as "step", fos.status_date as "stepDate"
FROM full_order_statuses fos
INNER JOIN stores s ON fos.store_id = s.store_id
INNER JOIN integration_channels ic ON s.integration_channel_id = ic.integration_channel_id
INNER JOIN integration_mappings im ON fos.external_status = im.external_value
    AND im."domain" = 'ORDER_STATUS'
    AND im.provider = UPPER(ic."name")
inner join order_invoice i on FOS.order_number = i.order_number and fos.store_id = i.store_id

UNION ALL

-- Aproveita o resultado da CTE
SELECT CONCAT('Nota Fiscal: ', cast(invoice_number as varchar), ' emitida'), created_at
FROM order_invoice
where created_at is not null

UNION ALL

-- Substitui a subquery no WHERE por um INNER JOIN direto com a CTE
SELECT concat('PLP: ', cast(p.plp_code as varchar), ' gerada'), p.generated_at
FROM order_invoice i
INNER JOIN plps p ON i.invoice_key = ANY(p.invoice_keys)

-- O ORDER BY no final afeta todo o resultado do UNION. O '2' refere-se à segunda coluna.
-- Use DESC se quiser da mais recente para a mais antiga.
ORDER BY 2 ASC;
  `;

  try {
    const result = await pool.query(query, [orderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar pedido", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao processar a solicitação." });
  }
});
export default router;
