import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import productRoutes from "./modules/products/product.routes.js";
import dispatchRoutes from "./modules/dispatch/dispatch.route.js";
import authRoutes from "./modules/auth/auth.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";
import storeRoutes from "./modules/stores/store.route.js";
import domainRoutes from "./modules/domain/domain.routes.js";
dotenv.config();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cors());

// Registra as rotas de forma modularizada
app.use("/api/inventory", inventoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/domain", domainRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Running on PORT=${PORT}...`);
});
