import express from "express";
import cors from "cors";
import { Pool } from "pg";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cors());

// Conexão direta com o banco de dados
const db = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/products", async (req, res) => {
  try {
    // 1. Extrai search, page e limit da query string (com valores padrão caso não sejam enviados)
    const { search, page = "1", limit = "10" } = req.query;

    // Converte para número inteiro
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    // Calcula o deslocamento (offset) para o SQL
    const offset = (pageNumber - 1) * limitNumber;

    // 2. Base da query SQL para buscar os dados
    let query = `
      SELECT
        product_id AS "productId",
        bar_code AS "barCode",
        model_sku AS "modelSku",
        image_url AS "imageUrl"
      FROM products
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    // 3. Condição de busca (opcional)
    if (search) {
      query += ` WHERE bar_code ILIKE $${paramIndex} OR model_sku ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 4. Adiciona Ordenação, Limite e Offset para a paginação
    // (Ex: ORDER BY id DESC para mostrar os mais recentes primeiro)
    query += ` ORDER BY model_sku DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limitNumber, offset);

    // 5. Executa a query principal
    const result = await db.query(query, queryParams);

    // 6. (Opcional mas recomendado) Busca o total de registros para o Front-end saber quantas páginas existem
    let countQuery = "SELECT COUNT(*) FROM products";
    const countParams: any[] = [];

    if (search) {
      countQuery += " WHERE bar_code ILIKE $1 OR model_sku ILIKE $1";
      countParams.push(`%${search}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNumber);

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

app.get("/api/products/:barCode", async (req, res) => {
  const { barCode } = req.params; // Captura o barCode da URL
  const queryText = `
    SELECT *
    FROM products
    WHERE bar_code = $1
  `;

  try {
    const result = await db.query(queryText, [barCode]);

    // Caso o ID informado não exista no banco
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    // Retorna o produto atualizado
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

app.put("/api/products/:barCode", async (req, res) => {
  const { barCode } = req.params; // Captura o barCode da URL
  const { modelSku, imageUrl } = req.body;

  const queryText = `
    UPDATE products
    SET model_sku = $1, image_url = $2
    WHERE bar_code = $3
    RETURNING *
  `;

  try {
    const result = await db.query(queryText, [modelSku, imageUrl, barCode]);

    // Caso o ID informado não exista no banco
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    // Retorna o produto atualizado
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Erro ao atualizar produto no banco" });
  }
});

app.post("/api/products", async (req, res) => {
  const { modelSku, barCode } = req.body;

  // Query SQL usando parâmetros ($1, $2) para evitar SQL Injection
  const queryText =
    "INSERT INTO products (model_sku, bar_code) VALUES ($1, $2) RETURNING *";

  try {
    const result = await db.query(queryText, [modelSku, barCode]);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Erro ao inserir no banco" });
  }
});

app.listen(PORT, () => {
  console.log(`Running on PORT=${PORT}...`);
});
