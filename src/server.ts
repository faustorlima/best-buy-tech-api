import express, { type Request, type Response } from "express";
import { S3Client } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cors());

// Conexão direta com o banco de dados
const db = new Pool({
  connectionString:
    "postgresql://bestbuy:J36XZHt0ii1CbBE@143.198.150.13:5432/bestbuydb",
});

const s3 = new S3Client({
  region: process.env.AWS_REGION!, // <--- Adicione o '!' aqui
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
// Multer configuration to store file in memory (Buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// 1. Instância do Multer com o S3
const uploadPhoto = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME!,
    key: (req, file, cb) => {
      const fileExtension = file.originalname.split(".").pop();
      const fileName = `${Date.now()}_${Math.round(Math.random() * 1e9)}.${fileExtension}`;
      cb(null, fileName);
    },
  }),
});

interface ProductImportDTO {
  modelSku: string;
  barCode: string;
  imeiCount: number;
}

app.post(
  "/api/products/import",
  upload.single("file"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided." });
      }

      const fileBuffer = req.file.buffer;
      const fileName = req.file.originalname.toLowerCase();
      let rawData: any[] = [];

      // 1. Process based on file extension/type
      if (fileName.endsWith(".csv") || req.file.mimetype === "text/csv") {
        const csvString = fileBuffer.toString("utf-8");
        const parseResult = Papa.parse(csvString, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
        });
        rawData = parseResult.data;
      } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileBuffer as any);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          return res.status(400).json({ error: "The spreadsheet is empty." });
        }

        const rows: any[] = [];
        let headers: string[] = [];

        worksheet.eachRow((row, rowNumber) => {
          const rowValues = (row.values as any[]).slice(1);

          if (rowNumber === 1) {
            headers = rowValues.map((h) => String(h).trim());
          } else {
            const rowObject: Record<string, any> = {};
            headers.forEach((header, index) => {
              rowObject[header] = rowValues[index];
            });
            rows.push(rowObject);
          }
        });
        rawData = rows;
      } else {
        return res.status(400).json({
          error:
            "Invalid file format. Only CSV and Excel (.xlsx/.xls) files are allowed.",
        });
      }

      if (rawData.length === 0) {
        return res
          .status(400)
          .json({ error: "The file is empty or has an incorrect format." });
      }

      const errorList: string[] = [];
      const validProducts: ProductImportDTO[] = [];

      // 2. Validate and map row by row
      rawData.forEach((row, index) => {
        const lineNumber = index + 2; // Header is on row 1

        // Maps Portuguese spreadsheet headers to technical DTO keys
        const modelSku =
          row["Sku"] || row["SKU"] || row["sku"] || row["modelSku"];
        const barCode =
          row["Código de Barras"] ||
          row["Codigo de Barras"] ||
          row["codigo de barras"] ||
          row["barCode"];
        const imeiCount =
          row["Quantidade de IMEIs"] ||
          row["Quantidade de Imeis"] ||
          row["quantidade de imeis"] ||
          row["imeiCount"];

        if (!modelSku) {
          errorList.push(
            `Line ${lineNumber}: The mandatory field 'Sku' is missing.`,
          );
          return;
        }

        // Validate imeiCount (must be a valid integer greater than or equal to zero)
        const parsedQuantity = Number(imeiCount);
        if (
          imeiCount !== undefined &&
          imeiCount !== null &&
          String(imeiCount).trim() !== "" &&
          (isNaN(parsedQuantity) || parsedQuantity < 0)
        ) {
          errorList.push(
            `Line ${lineNumber}: The field 'Quantidade de IMEIs' must be a valid number.`,
          );
          return;
        }

        validProducts.push({
          modelSku: String(modelSku).trim(),
          barCode: barCode ? String(barCode).trim() : "",
          imeiCount:
            !isNaN(parsedQuantity) && String(imeiCount).trim() !== ""
              ? parsedQuantity
              : 0,
        });
      });

      if (errorList.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation errors found in the spreadsheet.",
          errors: errorList,
        });
      }
      // Query modificada com INSERT ... ON CONFLICT (Upsert)
      const query = `
        INSERT INTO products (model_sku, bar_code, imei_count)
        VALUES ${validProducts.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2},$${i * 3 + 3})`).join(", ")}
        ON CONFLICT (model_sku)
        DO UPDATE SET
          bar_code = EXCLUDED.bar_code,
          imei_count = EXCLUDED.imei_count;
      `;
      const values = validProducts.flatMap((p) => [
        p.modelSku,
        p.barCode,
        p.imeiCount,
      ]);

      await db.query(query, values);

      return res.status(200).json({
        success: true,
        message: `${validProducts.length} produtos importados com sucesso!`,
        totalImported: validProducts.length,
      });
    } catch (error: any) {
      console.error("Error importing products:", error);
      return res.status(500).json({
        error: "Internal server error while processing the product file.",
      });
    }
  },
);

// Exemplo de rota DELETE para exclusão lógica
app.delete("/api/products/:barCode", async (req, res) => {
  const { barCode } = req.params;
  console.log("barCode", barCode);
  try {
    const query = `
      UPDATE products
      SET is_deleted = true, deleted_at = NOW()
      WHERE bar_code = $1
      RETURNING *;
    `;
    const values = [barCode];
    const result = await db.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    return res.status(200).json({
      message: "Produto excluído logicamente com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao realizar exclusão lógica:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao processar a solicitação." });
  }
});

app.get("/api/products", async (req, res) => {
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
      SELECT
        product_id AS "productId",
        bar_code AS "barCode",
        model_sku AS "modelSku",
        image_url AS "imageUrl",
        imei_count AS "imeiCount"
      FROM products
      WHERE is_deleted = false
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

// 1. Rota PUT ajustada com o prefixo /api e alisamento para camelCase
app.put(
  "/api/products/:barCode",
  uploadPhoto.single("image"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { modelSku } = req.body;
      const { barCode } = req.params;
      const imageUrl = (req.file as any)?.location;

      let query = "";
      let params: any[] = [];

      if (imageUrl) {
        query = `
        UPDATE products
        SET model_sku = $1, image_url = $2
        WHERE bar_code = $3
        RETURNING
          product_id AS "productId",
          bar_code AS "barCode",
          model_sku AS "modelSku",
          image_url AS "imageUrl",
          imei_count AS "imeiCount"
      `;
        params = [modelSku, imageUrl, barCode];
      } else {
        query = `
        UPDATE products
        SET model_sku = $1
        WHERE bar_code = $2
        RETURNING
          product_id AS "productId",
          bar_code AS "barCode",
          model_sku AS "modelSku",
          image_url AS "imageUrl",
          imei_count AS "imeiCount"
      `;
        params = [modelSku, barCode];
      }

      const result = await db.query(query, params);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      return res.status(500).json({ message: "Erro ao atualizar produto" });
    }
  },
);

// 2. Rota POST ajustada para aceitar FormData com upload opcional de imagem
app.post(
  "/api/products",
  uploadPhoto.single("image"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { modelSku, barCode } = req.body;
      const imageUrl = (req.file as any)?.location || null;

      const queryText = `
      INSERT INTO products (model_sku, bar_code, image_url)
      VALUES ($1, $2, $3)
      RETURNING
        product_id AS "productId",
        bar_code AS "barCode",
        model_sku AS "modelSku",
        image_url AS "imageUrl",
        imei_count AS "imeiCount"
    `;

      const result = await db.query(queryText, [modelSku, barCode, imageUrl]);
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao inserir produto:", error);
      return res.status(500).json({ error: "Erro ao inserir no banco" });
    }
  },
);

app.listen(PORT, () => {
  console.log(`Running on PORT=${PORT}...`);
});
