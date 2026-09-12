var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/src/db.ts
var db_exports = {};
__export(db_exports, {
  default: () => db_default
});
import { Pool } from "pg";
import dotenv from "dotenv";
var connectionString, isLocal, pool, db_default;
var init_db = __esm({
  "server/src/db.ts"() {
    "use strict";
    dotenv.config();
    connectionString = process.env.DATABASE_URL;
    isLocal = !connectionString || connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
    pool.on("error", (err) => {
      console.error("Unexpected error on idle PostgreSQL client:", err.message || err);
    });
    db_default = pool;
  }
});

// server/src/index.ts
import express from "express";
import cors from "cors";
import dotenv2 from "dotenv";

// server/src/routes/auth.ts
init_db();
import { Router } from "express";
import { body } from "express-validator";
import bcrypt from "bcryptjs";
import jwt2 from "jsonwebtoken";

// server/src/middleware/validate.ts
import { validationResult } from "express-validator";
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return;
  }
  next();
}

// server/src/middleware/auth.ts
import jwt from "jsonwebtoken";
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `Access denied. Required roles: ${roles.join(", ")}` });
      return;
    }
    next();
  };
}

// server/src/routes/auth.ts
var router = Router();
router.post(
  "/login",
  body("username").trim().notEmpty().withMessage("Username required"),
  body("password").notEmpty().withMessage("Password required"),
  handleValidation,
  async (req, res) => {
    const { username, password } = req.body;
    try {
      const result = await db_default.query(
        "SELECT id, username, password_hash, role, full_name FROM users WHERE username = $1",
        [username]
      );
      const user = result.rows[0];
      if (!user || !await bcrypt.compare(password, user.password_hash)) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const token = jwt2.sign(
        { userId: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET || "mini-erp-secret-key-2024",
        { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
      );
      res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: err.message || "Server error" });
    }
  }
);
router.get("/me", authenticate, async (req, res) => {
  try {
    const result = await db_default.query(
      "SELECT id, username, role, full_name FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Auth me error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});
var auth_default = router;

// server/src/routes/inventory.ts
init_db();
import { Router as Router2 } from "express";
import { body as body2, param } from "express-validator";
var router2 = Router2();
router2.get("/", authenticate, async (_req, res) => {
  try {
    const result = await db_default.query(
      "SELECT *, (physical_qty - reserved_qty) AS available_qty FROM inventory ORDER BY location, item"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});
router2.get(
  "/:id",
  authenticate,
  param("id").isUUID(),
  handleValidation,
  async (req, res) => {
    try {
      const result = await db_default.query(
        "SELECT *, (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE id = $1",
        [req.params.id]
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Server error" });
    }
  }
);
router2.post(
  "/",
  authenticate,
  authorize("admin", "operations"),
  body2("item").trim().notEmpty(),
  body2("category").trim().notEmpty(),
  body2("location").trim().notEmpty(),
  body2("physical_qty").isFloat({ min: 0 }).withMessage("physical_qty must be >= 0"),
  handleValidation,
  async (req, res) => {
    const { item, category, location, batch = "DEFAULT", physical_qty } = req.body;
    try {
      const result = await db_default.query(
        `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
         VALUES ($1, $2, $3, $4, $5, 0)
         RETURNING *, (physical_qty - reserved_qty) AS available_qty`,
        [item, category, location, batch, physical_qty]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        res.status(409).json({ error: "Inventory record already exists for this item/location/batch combination" });
        return;
      }
      res.status(500).json({ error: "Server error" });
    }
  }
);
router2.put(
  "/:id",
  authenticate,
  authorize("admin", "operations"),
  param("id").isUUID(),
  body2("physical_qty").optional().isFloat({ min: 0 }),
  body2("category").optional().trim().notEmpty(),
  body2("location").optional().trim().notEmpty(),
  handleValidation,
  async (req, res) => {
    const { physical_qty, category, location } = req.body;
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM inventory WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" });
        return;
      }
      const inv = current.rows[0];
      const newPhysical = physical_qty !== void 0 ? Number(physical_qty) : inv.physical_qty;
      if (newPhysical < inv.reserved_qty) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Cannot set physical_qty below reserved_qty (${inv.reserved_qty})` });
        return;
      }
      const result = await client.query(
        `UPDATE inventory SET
          physical_qty = $1, category = COALESCE($2, category), location = COALESCE($3, location)
         WHERE id = $4
         RETURNING *, (physical_qty - reserved_qty) AS available_qty`,
        [newPhysical, category, location, req.params.id]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
router2.delete(
  "/:id",
  authenticate,
  authorize("admin"),
  param("id").isUUID(),
  handleValidation,
  async (req, res) => {
    try {
      const result = await db_default.query("DELETE FROM inventory WHERE id = $1 RETURNING id", [req.params.id]);
      if (!result.rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ message: "Deleted successfully" });
    } catch {
      res.status(500).json({ error: "Server error" });
    }
  }
);
var inventory_default = router2;

// server/src/routes/workOrders.ts
init_db();
import { Router as Router3 } from "express";
import { body as body3, param as param2 } from "express-validator";
import { v4 as uuidv4 } from "uuid";
var router3 = Router3();
router3.get("/", authenticate, async (_req, res) => {
  try {
    const result = await db_default.query("SELECT * FROM work_orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});
router3.get(
  "/:id",
  authenticate,
  param2("id").isUUID(),
  handleValidation,
  async (req, res) => {
    try {
      const result = await db_default.query("SELECT * FROM work_orders WHERE id = $1", [req.params.id]);
      if (!result.rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Server error" });
    }
  }
);
router3.post(
  "/",
  authenticate,
  authorize("admin"),
  body3("location").trim().notEmpty(),
  body3("item").trim().notEmpty(),
  body3("required_qty").isFloat({ gt: 0 }).withMessage("required_qty must be > 0"),
  body3("assigned_user_id").optional().isUUID(),
  handleValidation,
  async (req, res) => {
    const { location, item, required_qty, assigned_user_id, notes } = req.body;
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const invResult = await client.query(
        "SELECT (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE item = $1 AND location = $2",
        [item, location]
      );
      const availableQty = invResult.rows.reduce((sum, r) => sum + Number(r.available_qty), 0);
      const shortage = Math.max(0, Number(required_qty) - availableQty);
      let assignedUsername = null;
      if (assigned_user_id) {
        const userRes = await client.query("SELECT username FROM users WHERE id = $1", [assigned_user_id]);
        assignedUsername = userRes.rows[0]?.username || null;
      }
      const workOrderId = `WO-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO work_orders (work_order_id, location, item, required_qty, assigned_user_id, assigned_username, shortage_qty, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [workOrderId, location, item, required_qty, assigned_user_id || null, assignedUsername, shortage, notes || null]
      );
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
router3.patch(
  "/:id/status",
  authenticate,
  authorize("admin", "operations"),
  param2("id").isUUID(),
  body3("status").isIn(["Assigned", "In Progress", "Completed"]).withMessage("Invalid status"),
  handleValidation,
  async (req, res) => {
    try {
      const result = await db_default.query(
        "UPDATE work_orders SET status = $1 WHERE id = $2 RETURNING *",
        [req.body.status, req.params.id]
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Server error" });
    }
  }
);
var workOrders_default = router3;

// server/src/routes/transfers.ts
init_db();
import { Router as Router4 } from "express";
import { body as body4, param as param3 } from "express-validator";
import { v4 as uuidv42 } from "uuid";
var router4 = Router4();
router4.get("/", authenticate, async (_req, res) => {
  try {
    const result = await db_default.query("SELECT * FROM internal_transfers ORDER BY created_at DESC");
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});
router4.post(
  "/",
  authenticate,
  authorize("admin", "operations"),
  body4("source_location").trim().notEmpty(),
  body4("destination_location").trim().notEmpty(),
  body4("item").trim().notEmpty(),
  body4("qty").isFloat({ gt: 0 }).withMessage("qty must be > 0"),
  body4("work_order_id").optional().trim(),
  handleValidation,
  async (req, res) => {
    const { source_location, destination_location, item, qty, work_order_id } = req.body;
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const invResult = await client.query(
        "SELECT (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE item = $1 AND location = $2 FOR UPDATE",
        [item, source_location]
      );
      const available = invResult.rows.reduce((sum, r) => sum + Number(r.available_qty), 0);
      if (available < Number(qty)) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Insufficient inventory. Available: ${available}, Requested: ${qty}` });
        return;
      }
      const transferId = `TRF-${Date.now()}-${uuidv42().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO internal_transfers (transfer_id, source_location, destination_location, item, qty, work_order_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [transferId, source_location, destination_location, item, qty, work_order_id || null]
      );
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
router4.patch(
  "/:id/dispatch",
  authenticate,
  authorize("admin", "operations"),
  param3("id").isUUID(),
  handleValidation,
  async (req, res) => {
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const transfer = await client.query(
        "SELECT * FROM internal_transfers WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!transfer.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      const t = transfer.rows[0];
      if (t.status !== "Requested") {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Cannot dispatch: transfer is already ${t.status}` });
        return;
      }
      const invUpdate = await client.query(
        `UPDATE inventory SET physical_qty = physical_qty - $1
         WHERE item = $2 AND location = $3 AND (physical_qty - reserved_qty) >= $1
         RETURNING id`,
        [t.qty, t.item, t.source_location]
      );
      if (invUpdate.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Insufficient available inventory at source to dispatch" });
        return;
      }
      const result = await client.query(
        `UPDATE internal_transfers SET status = 'Dispatched', dispatched_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
router4.patch(
  "/:id/receive",
  authenticate,
  authorize("admin", "operations"),
  param3("id").isUUID(),
  handleValidation,
  async (req, res) => {
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const transfer = await client.query(
        "SELECT * FROM internal_transfers WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!transfer.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      const t = transfer.rows[0];
      if (t.status === "Received") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Transfer has already been received (duplicate receipt prevented)" });
        return;
      }
      if (t.status !== "Dispatched") {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Cannot receive: transfer status is ${t.status}. Must be Dispatched first.` });
        return;
      }
      await client.query(
        `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
         SELECT $1, i.category, $2, $3, $4, 0
         FROM inventory i WHERE i.item = $1 LIMIT 1
         ON CONFLICT (item, location, batch) DO UPDATE
         SET physical_qty = inventory.physical_qty + EXCLUDED.physical_qty`,
        [t.item, t.destination_location, "DEFAULT", t.qty]
      );
      const result = await client.query(
        `UPDATE internal_transfers SET status = 'Received', received_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
var transfers_default = router4;

// server/src/routes/customerOrders.ts
init_db();
import { Router as Router5 } from "express";
import { body as body5, param as param4 } from "express-validator";
import { v4 as uuidv43 } from "uuid";
var router5 = Router5();
router5.get("/", authenticate, async (_req, res) => {
  try {
    const result = await db_default.query("SELECT * FROM customer_orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});
router5.post(
  "/",
  authenticate,
  authorize("sales", "admin"),
  body5("customer_name").trim().notEmpty(),
  body5("item").trim().notEmpty(),
  body5("location").trim().notEmpty(),
  body5("qty").isFloat({ gt: 0 }).withMessage("qty must be > 0"),
  handleValidation,
  async (req, res) => {
    const { customer_name, item, location, qty } = req.body;
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const invResult = await client.query(
        `SELECT id, (physical_qty - reserved_qty) AS available_qty
         FROM inventory WHERE item = $1 AND location = $2 FOR UPDATE`,
        [item, location]
      );
      if (invResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "No inventory found for this item at this location" });
        return;
      }
      const totalAvailable = invResult.rows.reduce((sum, r) => sum + Number(r.available_qty), 0);
      if (totalAvailable < Number(qty)) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: `Insufficient available inventory. Available: ${totalAvailable}, Requested: ${qty}`
        });
        return;
      }
      let remaining = Number(qty);
      for (const row of invResult.rows) {
        if (remaining <= 0) break;
        const toReserve = Math.min(remaining, Number(row.available_qty));
        await client.query(
          "UPDATE inventory SET reserved_qty = reserved_qty + $1 WHERE id = $2",
          [toReserve, row.id]
        );
        remaining -= toReserve;
      }
      const orderId = `ORD-${Date.now()}-${uuidv43().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO customer_orders (order_id, customer_name, item, location, qty, status, created_by_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5, 'Reserved', $6, $7) RETURNING *`,
        [orderId, customer_name, item, location, qty, req.user.userId, req.user.username]
      );
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
router5.patch(
  "/:id/cancel",
  authenticate,
  authorize("sales", "admin"),
  param4("id").isUUID(),
  handleValidation,
  async (req, res) => {
    const client = await db_default.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "SELECT * FROM customer_orders WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!order.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Order not found" });
        return;
      }
      const o = order.rows[0];
      if (o.status !== "Reserved") {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Cannot cancel order with status ${o.status}` });
        return;
      }
      await client.query(
        `UPDATE inventory SET reserved_qty = GREATEST(0, reserved_qty - $1)
         WHERE item = $2 AND location = $3`,
        [o.qty, o.item, o.location]
      );
      const result = await client.query(
        "UPDATE customer_orders SET status = 'Cancelled' WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  }
);
var customerOrders_default = router5;

// server/src/index.ts
import path from "path";
import fs from "fs";
dotenv2.config();
var app = express();
var PORT = process.env.PORT || 4e3;
app.use(cors());
app.use(express.json());
var apiRouter = express.Router();
apiRouter.get("/health", async (_req, res) => {
  let dbStatus = "disconnected";
  if (process.env.DATABASE_URL) {
    try {
      const pool2 = (await Promise.resolve().then(() => (init_db(), db_exports))).default;
      await pool2.query("SELECT 1");
      dbStatus = "connected";
    } catch (e) {
      dbStatus = `error: ${e.message}`;
    }
  } else {
    dbStatus = "DATABASE_URL not configured";
  }
  res.json({
    status: "ok",
    database: dbStatus,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});
apiRouter.use("/auth", auth_default);
apiRouter.use("/inventory", inventory_default);
apiRouter.use("/work-orders", workOrders_default);
apiRouter.use("/transfers", transfers_default);
apiRouter.use("/customer-orders", customerOrders_default);
app.use("/api", apiRouter);
app.use("/", apiRouter);
var possibleDistPaths = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(process.cwd(), "server/dist")
];
var distPath = possibleDistPaths.find((p) => fs.existsSync(p)) || path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});
if (typeof __require !== "undefined" && typeof module !== "undefined" && __require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mini ERP Server running on port ${PORT}`);
    const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
    if (serverUrl) {
      console.log(`\u{1F4E1} Keep-alive cron enabled for ${serverUrl}/health (every 10 min)`);
      setInterval(() => {
        fetch(`${serverUrl}/health`).then((res) => console.log(`[Keep-Alive Ping] Status: ${res.status}`)).catch((err) => console.error("[Keep-Alive Ping Error]", err.message));
      }, 10 * 60 * 1e3);
    }
  });
}
var index_default = app;
export {
  index_default as default
};
