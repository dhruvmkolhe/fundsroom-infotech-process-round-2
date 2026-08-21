# Mini Operations ERP - API Documentation

Base URL: `http://localhost:4000/api`

All protected endpoints require `Authorization: Bearer <token>` header.

---

## Health Check

### GET /health
No authentication required.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Authentication

### POST /api/auth/login

Authenticates a user and returns a JWT token.

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "role": "admin",
    "full_name": "System Administrator"
  }
}
```

**Response 401 (invalid credentials):**
```json
{ "error": "Invalid credentials" }
```

**Response 400 (validation):**
```json
{
  "error": "Validation failed",
  "details": [{ "msg": "Username required", "path": "username" }]
}
```

---

### GET /api/auth/me

Returns the currently authenticated user's profile.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "admin",
  "role": "admin",
  "full_name": "System Administrator"
}
```

**Response 401:**
```json
{ "error": "No token provided" }
```

---

## Inventory

### GET /api/inventory

List all inventory items. Available to all authenticated roles (admin, operations, sales).

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "item": "Steel Rods",
    "category": "Raw Material",
    "location": "Warehouse A",
    "batch": "BATCH-001",
    "physical_qty": "500.00",
    "reserved_qty": "50.00",
    "available_qty": "450.00",
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### GET /api/inventory/:id

Get a single inventory item by UUID.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "item": "Steel Rods",
  "category": "Raw Material",
  "location": "Warehouse A",
  "batch": "BATCH-001",
  "physical_qty": "500.00",
  "reserved_qty": "50.00",
  "available_qty": "450.00",
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:00:00.000Z"
}
```

**Response 404:**
```json
{ "error": "Not found" }
```

---

### POST /api/inventory

Create a new inventory record. Requires `admin` or `operations` role.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "item": "Steel Rods",
  "category": "Raw Material",
  "location": "Warehouse D",
  "batch": "BATCH-006",
  "physical_qty": 200
}
```

Note: `batch` defaults to `"DEFAULT"` if omitted.

**Response 201:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "item": "Steel Rods",
  "category": "Raw Material",
  "location": "Warehouse D",
  "batch": "BATCH-006",
  "physical_qty": "200.00",
  "reserved_qty": "0.00",
  "available_qty": "200.00",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

**Response 409 (duplicate item/location/batch):**
```json
{ "error": "Inventory record already exists for this item/location/batch combination" }
```

**Response 403 (wrong role):**
```json
{ "error": "Access denied. Required roles: admin, operations" }
```

---

### PUT /api/inventory/:id

Update an inventory item's physical quantity, category, or location. Requires `admin` or `operations` role. Uses row-level locking to prevent race conditions.

**Headers:** `Authorization: Bearer <token>`

**Request Body (all fields optional):**
```json
{
  "physical_qty": 600,
  "category": "Raw Material",
  "location": "Warehouse A"
}
```

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "item": "Steel Rods",
  "category": "Raw Material",
  "location": "Warehouse A",
  "batch": "BATCH-001",
  "physical_qty": "600.00",
  "reserved_qty": "50.00",
  "available_qty": "550.00",
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T11:00:00.000Z"
}
```

**Response 400 (physical_qty below reserved_qty):**
```json
{ "error": "Cannot set physical_qty below reserved_qty (50)" }
```

---

### DELETE /api/inventory/:id

Delete an inventory record. Requires `admin` role only.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{ "message": "Deleted successfully" }
```

**Response 404:**
```json
{ "error": "Not found" }
```

---

## Work Orders

### GET /api/work-orders

List all work orders ordered by creation date (newest first). All authenticated roles.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
[
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "work_order_id": "WO-1705312200000-ABC123",
    "location": "Warehouse A",
    "item": "Steel Rods",
    "required_qty": "100.00",
    "assigned_user_id": "550e8400-e29b-41d4-a716-446655440000",
    "assigned_username": "ops_user",
    "status": "Assigned",
    "shortage_qty": "0.00",
    "notes": "Urgent order for production line",
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### GET /api/work-orders/:id

Get a single work order by UUID.

**Headers:** `Authorization: Bearer <token>`

**Response 200:** Same structure as single item in list above.

**Response 404:**
```json
{ "error": "Not found" }
```

---

### POST /api/work-orders

Create a new work order. Automatically calculates `shortage_qty` based on current available inventory at the specified location. Requires `admin` role.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "location": "Warehouse A",
  "item": "Steel Rods",
  "required_qty": 100,
  "assigned_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "notes": "Urgent for production line 3"
}
```

Note: `assigned_user_id` and `notes` are optional.

**Response 201:**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "work_order_id": "WO-1705312200000-ABC123",
  "location": "Warehouse A",
  "item": "Steel Rods",
  "required_qty": "100.00",
  "assigned_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "assigned_username": "ops_user",
  "status": "Assigned",
  "shortage_qty": "0.00",
  "notes": "Urgent for production line 3",
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:00:00.000Z"
}
```

---

### PATCH /api/work-orders/:id/status

Update a work order's status. Requires `admin` or `operations` role.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "status": "In Progress"
}
```

Valid status values: `"Assigned"`, `"In Progress"`, `"Completed"`

**Response 200:**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "work_order_id": "WO-1705312200000-ABC123",
  "status": "In Progress",
  ...
}
```

**Response 400 (invalid status):**
```json
{
  "error": "Validation failed",
  "details": [{ "msg": "Invalid status", "path": "status" }]
}
```

---

## Internal Transfers

### GET /api/transfers

List all internal transfers ordered by creation date (newest first). All authenticated roles.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
[
  {
    "id": "770e8400-e29b-41d4-a716-446655440001",
    "transfer_id": "TRF-1705312200000-XYZ789",
    "source_location": "Warehouse A",
    "destination_location": "Warehouse B",
    "item": "Steel Rods",
    "qty": "50.00",
    "status": "Requested",
    "work_order_id": "WO-1705312200000-ABC123",
    "dispatched_at": null,
    "received_at": null,
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### POST /api/transfers

Create a new internal transfer request. Validates that sufficient available inventory exists at the source location. Requires `admin` or `operations` role.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "source_location": "Warehouse A",
  "destination_location": "Warehouse B",
  "item": "Steel Rods",
  "qty": 50,
  "work_order_id": "WO-1705312200000-ABC123"
}
```

Note: `work_order_id` is optional.

**Response 201:**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440001",
  "transfer_id": "TRF-1705312200000-XYZ789",
  "source_location": "Warehouse A",
  "destination_location": "Warehouse B",
  "item": "Steel Rods",
  "qty": "50.00",
  "status": "Requested",
  "work_order_id": "WO-1705312200000-ABC123",
  "dispatched_at": null,
  "received_at": null,
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:00:00.000Z"
}
```

**Response 400 (insufficient inventory):**
```json
{ "error": "Insufficient inventory. Available: 30, Requested: 50" }
```

---

### PATCH /api/transfers/:id/dispatch

Mark a transfer as dispatched. Reduces the source location's `physical_qty` by the transfer quantity. Transfer must be in `Requested` status. Requires `admin` or `operations` role.

**Headers:** `Authorization: Bearer <token>`

**No request body required.**

**Response 200:**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440001",
  "transfer_id": "TRF-1705312200000-XYZ789",
  "status": "Dispatched",
  "dispatched_at": "2024-01-15T11:00:00.000Z",
  ...
}
```

**Response 400 (wrong status):**
```json
{ "error": "Cannot dispatch: transfer is already Dispatched" }
```

**Response 400 (insufficient inventory at dispatch time):**
```json
{ "error": "Insufficient available inventory at source to dispatch" }
```

---

### PATCH /api/transfers/:id/receive

Mark a transfer as received. Upserts the transferred quantity into the destination location's inventory. Transfer must be in `Dispatched` status. Duplicate receipts are prevented (idempotency check). Requires `admin` or `operations` role.

**Headers:** `Authorization: Bearer <token>`

**No request body required.**

**Response 200:**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440001",
  "transfer_id": "TRF-1705312200000-XYZ789",
  "status": "Received",
  "dispatched_at": "2024-01-15T11:00:00.000Z",
  "received_at": "2024-01-15T12:00:00.000Z",
  ...
}
```

**Response 409 (already received):**
```json
{ "error": "Transfer has already been received (duplicate receipt prevented)" }
```

**Response 400 (not dispatched):**
```json
{ "error": "Cannot receive: transfer status is Requested. Must be Dispatched first." }
```

---

## Customer Orders

### GET /api/customer-orders

List all customer orders ordered by creation date (newest first). All authenticated roles.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
[
  {
    "id": "880e8400-e29b-41d4-a716-446655440001",
    "order_id": "ORD-1705312200000-DEF456",
    "customer_name": "Acme Corp",
    "item": "Steel Rods",
    "location": "Warehouse A",
    "qty": "20.00",
    "status": "Reserved",
    "created_by_id": "550e8400-e29b-41d4-a716-446655440003",
    "created_by_username": "sales_user",
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### POST /api/customer-orders

Create a new customer order and atomically reserve the specified quantity from inventory. Uses `SELECT FOR UPDATE` to prevent concurrent over-reservation. Requires `sales` or `admin` role.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "customer_name": "Acme Corp",
  "item": "Steel Rods",
  "location": "Warehouse A",
  "qty": 20
}
```

**Response 201:**
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440001",
  "order_id": "ORD-1705312200000-DEF456",
  "customer_name": "Acme Corp",
  "item": "Steel Rods",
  "location": "Warehouse A",
  "qty": "20.00",
  "status": "Reserved",
  "created_by_id": "550e8400-e29b-41d4-a716-446655440003",
  "created_by_username": "sales_user",
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:00:00.000Z"
}
```

**Response 400 (insufficient inventory):**
```json
{ "error": "Insufficient available inventory. Available: 10, Requested: 20" }
```

**Response 404 (no inventory at location):**
```json
{ "error": "No inventory found for this item at this location" }
```

---

### PATCH /api/customer-orders/:id/cancel

Cancel a customer order and release its reserved inventory back into the available pool. Order must be in `Reserved` status. Requires `sales` or `admin` role.

**Headers:** `Authorization: Bearer <token>`

**No request body required.**

**Response 200:**
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440001",
  "order_id": "ORD-1705312200000-DEF456",
  "customer_name": "Acme Corp",
  "item": "Steel Rods",
  "location": "Warehouse A",
  "qty": "20.00",
  "status": "Cancelled",
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T11:00:00.000Z"
}
```

**Response 400 (wrong status):**
```json
{ "error": "Cannot cancel order with status Fulfilled" }
```

**Response 404:**
```json
{ "error": "Order not found" }
```

---

## Role Permissions Summary

| Endpoint                              | admin | operations | sales |
|---------------------------------------|-------|------------|-------|
| GET /api/auth/me                      | YES   | YES        | YES   |
| POST /api/auth/login                  | YES   | YES        | YES   |
| GET /api/inventory                    | YES   | YES        | YES   |
| GET /api/inventory/:id                | YES   | YES        | YES   |
| POST /api/inventory                   | YES   | YES        | NO    |
| PUT /api/inventory/:id                | YES   | YES        | NO    |
| DELETE /api/inventory/:id             | YES   | NO         | NO    |
| GET /api/work-orders                  | YES   | YES        | YES   |
| GET /api/work-orders/:id              | YES   | YES        | YES   |
| POST /api/work-orders                 | YES   | NO         | NO    |
| PATCH /api/work-orders/:id/status     | YES   | YES        | NO    |
| GET /api/transfers                    | YES   | YES        | YES   |
| POST /api/transfers                   | YES   | YES        | NO    |
| PATCH /api/transfers/:id/dispatch     | YES   | YES        | NO    |
| PATCH /api/transfers/:id/receive      | YES   | YES        | NO    |
| GET /api/customer-orders              | YES   | YES        | YES   |
| POST /api/customer-orders             | YES   | NO         | YES   |
| PATCH /api/customer-orders/:id/cancel | YES   | NO         | YES   |

---

## Error Response Format

All error responses follow this structure:

```json
{ "error": "Human-readable error message" }
```

Validation errors include details:

```json
{
  "error": "Validation failed",
  "details": [
    {
      "type": "field",
      "msg": "physical_qty must be >= 0",
      "path": "physical_qty",
      "location": "body"
    }
  ]
}
```

## HTTP Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 200  | Success                              |
| 201  | Created                              |
| 400  | Bad request / business rule violated |
| 401  | Not authenticated                    |
| 403  | Forbidden (insufficient role)        |
| 404  | Resource not found                   |
| 409  | Conflict (duplicate / already done)  |
| 500  | Internal server error                |
