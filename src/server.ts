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
    const result = await db.query("SELECT * FROM products");
    return res.json(result.rows);
  } catch (error) {
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
