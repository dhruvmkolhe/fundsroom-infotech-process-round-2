# Mini Operations ERP

A full-stack operations ERP system for managing inventory, work orders, internal transfers, and customer orders. Built with Node.js, TypeScript, Express, PostgreSQL on the backend, with role-based access control and transactional inventory management.

---

## Tech Stack

### Backend (server/)
- **Runtime:** Node.js 20+
- **Language:** TypeScript 5
- **Framework:** Express 4
- **Database:** PostgreSQL 14+
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Validation:** express-validator
- **Testing:** Jest + Supertest + ts-jest
- **Dev tooling:** ts-node-dev
- **API Docs:** OpenAPI 3.0 (`server/swagger.yaml`) + `server/API_DOCS.md`

### Frontend (src/)
- **Framework:** React 18 + TypeScript (Vite)
- **Styling:** Tailwind CSS v4
- **Icons:** Lucide React
- **API Client:** Native `fetch` with JWT bearer tokens (`src/app/api.ts`)
- **Dev proxy:** Vite forwards `/api/*` → `http://localhost:4000` (no CORS issues)

---

## Prerequisites

- Node.js >= 18
- npm >= 9
- PostgreSQL >= 14 running locally (or a DATABASE_URL connection string)

---

## Installation

### 1. Clone the repository

```bash
git clone <repo-url>
cd mini-erp
```

### 2. Install server dependencies

```bash
cd server
npm install
```

### 3. Install client dependencies (if applicable)

```bash
cd ..
npm install
```

---

## Database Setup

### Step 1: Create the database

```bash
psql -U postgres -c "CREATE DATABASE mini_erp;"
```

### Step 2: Run the schema

```bash
psql -U postgres -d mini_erp -f server/schema.sql
```

This creates all tables, indexes, and triggers:
- `users` — user accounts with roles
- `inventory` — stock records with physical/reserved quantities
- `work_orders` — production work orders
- `internal_transfers` — stock movements between locations
- `customer_orders` — sales reservations

### Step 3: Seed the database

```bash
cd server
npm run db:seed
```

This inserts 3 default users and 7 inventory records.

---

## Environment Variables

Copy the example file and fill in your values:

```bash
cp server/.env.example server/.env
```

| Variable       | Description                                | Default                                      |
|----------------|--------------------------------------------|----------------------------------------------|
| `PORT`         | Port the Express server listens on         | `4000`                                       |
| `DATABASE_URL` | PostgreSQL connection string               | `postgresql://postgres:password@localhost:5432/mini_erp` |
| `JWT_SECRET`   | Secret key for signing JWT tokens          | (required — change in production)            |
| `JWT_EXPIRES_IN` | JWT token expiry duration               | `24h`                                        |
| `NODE_ENV`     | Environment mode                           | `development`                                |

---

## Running the Server

### Development (hot reload)

```bash
cd server
npm run dev
```

The server starts on `http://localhost:4000`.

### Production

```bash
cd server
npm run build
npm start
```

### Health check

```
GET http://localhost:4000/health
```

---

## Running the Client

```bash
# From the project root
npm run dev
```

The client runs on `http://localhost:5173` (Vite default).

> **Note:** The frontend dev server proxies `/api/*` to `http://localhost:4000` via Vite — make sure the backend is running first.

---

## Production Deployment

The frontend is a static React app (deployable to Vercel/Netlify).
The backend needs a server with a PostgreSQL database (Railway recommended).

### Backend → Railway (free tier)

1. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Select this repository
3. Railway uses `railway.json` at the root — it builds & starts the Express server automatically
4. In Railway, click **+ Add Plugin → PostgreSQL** → Railway auto-sets `DATABASE_URL`
5. Add these environment variables in Railway's Variables tab:

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | any long random string |
   | `JWT_EXPIRES_IN` | `24h` |
   | `NODE_ENV` | `production` |
   | `CORS_ORIGIN` | `https://fundsroom-infotech-process-round-2.vercel.app` |

6. After deploy, run the schema: copy your Railway `DATABASE_URL` and run:
   ```bash
   psql "postgresql://..." -f server/schema.sql
   ```
7. Seed the database:
   ```bash
   cd server
   DATABASE_URL="postgresql://..." npm run db:seed
   ```
8. Note your Railway backend URL, e.g. `https://mini-erp-backend.railway.app`

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project → Import GitHub repo**
2. Vercel auto-detects Vite; build settings should be:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add this environment variable in Vercel's Settings → Environment Variables:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `https://your-railway-backend.railway.app/api` |

4. Redeploy (Vercel → Deployments → Redeploy) — login will now work ✅

---

## Running Tests

Tests require a live PostgreSQL database. Make sure `DATABASE_URL` is set (either via `.env` or environment).

```bash
cd server
npm test
```

Tests run sequentially (`--runInBand`) and force exit after completion to release DB connections.

### What the tests cover

| Test | Description |
|------|-------------|
| TEST 1 | Cannot reserve more inventory than is available (customer order) |
| TEST 2 | Cannot create a transfer for more than available inventory |
| TEST 3 | Destination stock does NOT increase before a transfer is received |
| TEST 4 | A transfer cannot be received twice (idempotency / 409 conflict) |
| TEST 5 | Sales role cannot create inventory (403 forbidden) |
| TEST 5b | Unauthenticated requests are rejected (401) |

---

## Default Credentials

After running `npm run db:seed`:

| Username    | Password   | Role        |
|-------------|------------|-------------|
| `admin`     | `admin123` | admin       |
| `ops_user`  | `ops123`   | operations  |
| `sales_user`| `sales123` | sales       |

---

## API Base URL

```
http://localhost:4000/api
```

### API Documentation

Two formats are provided:

1. **Swagger / OpenAPI 3.0** — `server/swagger.yaml`
   - Paste into [Swagger Editor](https://editor.swagger.io/) for interactive docs
   - Or serve with `npx swagger-ui-serve server/swagger.yaml`

2. **Markdown reference** — `server/API_DOCS.md`
   - Human-readable endpoint reference with request/response examples

### Endpoint Summary

| Method | Path                                  | Roles              | Description                          |
|--------|---------------------------------------|--------------------|--------------------------------------|
| POST   | /api/auth/login                       | Public             | Login and receive JWT                |
| GET    | /api/auth/me                          | All                | Get current user profile             |
| GET    | /api/inventory                        | All                | List all inventory                   |
| GET    | /api/inventory/:id                    | All                | Get inventory item                   |
| POST   | /api/inventory                        | admin, operations  | Create inventory record              |
| PUT    | /api/inventory/:id                    | admin, operations  | Update physical qty / details        |
| DELETE | /api/inventory/:id                    | admin              | Delete inventory record              |
| GET    | /api/work-orders                      | All                | List work orders                     |
| GET    | /api/work-orders/:id                  | All                | Get work order                       |
| POST   | /api/work-orders                      | admin              | Create work order (auto shortage)    |
| PATCH  | /api/work-orders/:id/status           | admin, operations  | Update work order status             |
| GET    | /api/transfers                        | All                | List transfers                       |
| POST   | /api/transfers                        | admin, operations  | Create transfer request              |
| PATCH  | /api/transfers/:id/dispatch           | admin, operations  | Dispatch transfer (reduce source)    |
| PATCH  | /api/transfers/:id/receive            | admin, operations  | Receive transfer (increase dest)     |
| GET    | /api/customer-orders                  | All                | List customer orders                 |
| POST   | /api/customer-orders                  | admin, sales       | Create order and reserve inventory   |
| PATCH  | /api/customer-orders/:id/cancel       | admin, sales       | Cancel and release reservation       |

---

## ER Diagram

```
users
+--------------------+
| id (PK, UUID)      |
| username (UNIQUE)  |
| password_hash      |
| role               |  <-- 'admin' | 'operations' | 'sales'
| full_name          |
| created_at         |
+--------------------+
        |
        | 1:N (assigned_user_id)
        |                           1:N (created_by_id)
        v                                    v
work_orders                         customer_orders
+-------------------------+          +------------------------+
| id (PK, UUID)           |          | id (PK, UUID)          |
| work_order_id (UNIQUE)  |<---+     | order_id (UNIQUE)      |
| location                |   |     | customer_name          |
| item                    |   |     | item                   |
| required_qty            |   |     | location               |
| assigned_user_id (FK)   |   |     | qty                    |
| assigned_username       |   |     | status                 |
| status                  |   |     | created_by_id (FK)     |
| shortage_qty            |   |     | created_by_username    |
| notes                   |   |     | created_at             |
| created_at              |   |     | updated_at             |
| updated_at              |   |     +------------------------+
+-------------------------+   |
                              |
internal_transfers            |
+---------------------------+ |
| id (PK, UUID)             | |
| transfer_id (UNIQUE)      | |
| source_location           | |
| destination_location      | |
| item                      | |
| qty                       | |
| status                    | |
| work_order_id (FK) -------+-+  references work_orders(work_order_id)
| dispatched_at             |
| received_at               |
| created_at                |
| updated_at                |
+---------------------------+

inventory
+------------------------+
| id (PK, UUID)          |
| item                   |
| category               |
| location               |
| batch                  |
| physical_qty           |
| reserved_qty           |
| available_qty          |  <-- computed: physical_qty - reserved_qty
| created_at             |
| updated_at             |
+------------------------+
UNIQUE (item, location, batch)

Key business rules:
- customer_orders.reserved  <--> inventory.reserved_qty  (atomically updated via SELECT FOR UPDATE)
- internal_transfers dispatch <--> inventory.physical_qty at source (reduced on dispatch)
- internal_transfers receive  <--> inventory.physical_qty at destination (upserted on receive)
- work_orders.shortage_qty is computed at creation time from available inventory
```

---

## Project Structure

```
/
├── .gitignore
├── README.md
├── package.json                # Frontend deps + Vite config
├── vite.config.ts              # Vite + proxy /api → localhost:4000
├── src/                        # Frontend source (React)
│   ├── main.tsx
│   └── app/
│       ├── App.tsx             # All 5 screens + async API wiring
│       └── api.ts              # Typed fetch client for all endpoints
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── jest.config.js
    ├── .env.example            # Environment variable template
    ├── schema.sql              # Database DDL
    ├── swagger.yaml            # OpenAPI 3.0 specification
    ├── API_DOCS.md             # Full API reference (markdown)
    ├── src/
    │   ├── index.ts            # Express app entry point
    │   ├── db.ts               # PostgreSQL pool
    │   ├── types.ts            # Shared TypeScript interfaces
    │   ├── seed.ts             # Database seeder
    │   ├── middleware/
    │   │   ├── auth.ts         # JWT authenticate + authorize
    │   │   └── validate.ts     # express-validator error handler
    │   └── routes/
    │       ├── auth.ts         # /api/auth/*
    │       ├── inventory.ts    # /api/inventory/*
    │       ├── workOrders.ts   # /api/work-orders/*
    │       ├── transfers.ts    # /api/transfers/*
    │       └── customerOrders.ts # /api/customer-orders/*
    └── tests/
        ├── inventory.test.ts   # Inventory + auth tests (Tests 1, 5, 5b)
        └── transfers.test.ts   # Transfer lifecycle tests (Tests 2, 3, 4)
```
