import express, { type Request, type Response, Router } from "express";
import {
  authenticateToken,
  type AuthRequest,
} from "../auth/middlewares/authMiddleware.js";
import { Pool } from "pg";

const router = Router();

// Aplica o middleware a TODAS as rotas declaradas abaixo deste ponto neste ficheiro
//router.use(authenticateToken);

// Conexão direta com o banco de dados
const pool = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

router.get("/", async (req, res) => {
  const queryParams: any[] = [];
  let paramIndex = 1;

  // 2. Base da query SQL para buscar os dados
  let queryData = `
    select	fo.full_order_id as "orderId",
            fo.order_number  as "orderNumber",
            COALESCE(im.internal_value, fo.order_original_status) as "orderStatus",
            fo.order_status_date as "orderStatusDate",
            s."name" as "storeName",
            ic."name" as "platformName",
            i.invoice_number as "invoiceNumber",
            i.nf_status as "invoiceStatus",
            i.external_id as "invoiceExternalId",
            case
              when i.invoice_shopee_xml is not null
              then true
              else false
            end as "invoiceHasXML",
            i.error_details as "invoiceErrorDetails",
            i.invoice_key as "invoiceKey"
    `;

  let queryFromAndFilter = `
    from	full_orders fo
    inner 	join public.integration_channels ic on fo.integration_channel_id = ic.integration_channel_id
    inner 	join public.stores s on fo.store_id = s.store_id
    left 	join public.integration_mappings im on fo.order_original_status = im.external_value and im.provider = UPPER(ic.name) and im.domain = 'ORDER_STATUS'
    left	join invoices i on fo.order_number = i.order_number and fo.store_id = i.store_id
    where	fo.store_id = 1
    and		fo.order_payment_date >= '2026-10-19 00:00:00'
    and		fo.order_payment_date <= '2026-10-19 23:59:59'
    `;

  // 4. Adiciona Ordenação, Limite e Offset para a paginação
  // (Ex: ORDER BY id DESC para mostrar os mais recentes primeiro)
  let queryPaging = ` ORDER BY fo.order_payment_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

  let query = `${queryData} ${queryFromAndFilter} ${queryPaging}`;

  try {
    // 1. Extrai search, page e limit da query string (com valores padrão caso não sejam enviados)
    let { page = "1", limit = "10" } = req.query;

    // Converte para número inteiro
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    console.log("page", page);
    console.log("limit", limit);

    // Calcula o deslocamento (offset) para o SQL
    const offset = (pageNumber - 1) * limitNumber;

    queryParams.push(limitNumber, offset);

    const result = await pool.query(query, queryParams);

    // 6. (Opcional mas recomendado) Busca o total de registros para o Front-end saber quantas páginas existem
    let countQuery = "SELECT COUNT(*) ";
    countQuery += queryFromAndFilter;

    const countParams: any[] = [];

    const countResult = await pool.query(countQuery, countParams);
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
    return res.status(500).json({
      error: "Erro ao buscar pedidos",
      query: query
        .replace(/\\r\\n|\\n|\\r|\\t/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
});

export default router;
