-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operations', 'sales', 'customer')),
  full_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure customer role is permitted even if table already exists
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operations', 'sales', 'customer'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Inventory table with computed available_qty
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  location VARCHAR(100) NOT NULL,
  batch VARCHAR(50) DEFAULT 'DEFAULT',
  physical_qty NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item, location, batch)
);

-- Work orders table
CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id VARCHAR(50) UNIQUE NOT NULL,
  location VARCHAR(100) NOT NULL,
  item VARCHAR(100) NOT NULL,
  required_qty NUMERIC(10,2) NOT NULL CHECK (required_qty > 0),
  assigned_user_id UUID REFERENCES users(id),
  assigned_username VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned', 'In Progress', 'Completed')),
  shortage_qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Internal transfers table
CREATE TABLE IF NOT EXISTS internal_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id VARCHAR(50) UNIQUE NOT NULL,
  source_location VARCHAR(100) NOT NULL,
  destination_location VARCHAR(100) NOT NULL,
  item VARCHAR(100) NOT NULL,
  qty NUMERIC(10,2) NOT NULL CHECK (qty > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Dispatched', 'Received')),
  work_order_id VARCHAR(50) REFERENCES work_orders(work_order_id),
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer orders table
CREATE TABLE IF NOT EXISTS customer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(50) UNIQUE NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  item VARCHAR(100) NOT NULL,
  location VARCHAR(100) NOT NULL,
  qty NUMERIC(10,2) NOT NULL CHECK (qty > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Reserved' CHECK (status IN ('Pending', 'Reserved', 'Fulfilled', 'Cancelled')),
  created_by_id UUID REFERENCES users(id),
  created_by_username VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_item_location ON inventory(item, location);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON internal_transfers(status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_updated_at ON inventory;
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS work_orders_updated_at ON work_orders;
CREATE TRIGGER work_orders_updated_at BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS transfers_updated_at ON internal_transfers;
CREATE TRIGGER transfers_updated_at BEFORE UPDATE ON internal_transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS customer_orders_updated_at ON customer_orders;
CREATE TRIGGER customer_orders_updated_at BEFORE UPDATE ON customer_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
