import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import pool from './db';
import dotenv from 'dotenv';

dotenv.config();

async function setupDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL environment variable is required to set up the database.');
    process.exit(1);
  }

  console.log('🚀 Starting database schema setup and seeding...');
  const client = await pool.connect();

  try {
    // 1. Read and apply schema.sql
    const schemaPaths = [
      path.resolve(__dirname, '../schema.sql'),
      path.resolve(__dirname, '../../server/schema.sql'),
      path.resolve(process.cwd(), 'server/schema.sql'),
      path.resolve(process.cwd(), 'schema.sql'),
    ];
    const schemaPath = schemaPaths.find((p) => fs.existsSync(p));

    if (!schemaPath) {
      throw new Error('schema.sql could not be found.');
    }

    console.log(`📄 Reading schema from ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('⚙️ Applying schema (tables, triggers, indexes)...');
    await client.query(schemaSql);
    console.log('✅ Schema created successfully!');

    // Ensure customer role is permitted
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operations', 'sales', 'customer'));
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    // 2. Seed initial data
    console.log('🌱 Seeding expanded users, inventory, customer orders, work orders & transfers...');
    await client.query('BEGIN');

    const adminHash = await bcrypt.hash('admin123', 10);
    const opsHash = await bcrypt.hash('ops123', 10);
    const salesHash = await bcrypt.hash('sales123', 10);
    const customerHash = await bcrypt.hash('customer123', 10);

    // Insert Users
    await client.query(
      `
      INSERT INTO users (username, password_hash, role, full_name) VALUES
      ('admin', $1, 'admin', 'System Administrator'),
      ('ops_user', $2, 'operations', 'Operations Manager'),
      ('ops_lead', $2, 'operations', 'Warehouse Supervisor'),
      ('sales_user', $3, 'sales', 'Sales Representative'),
      ('sales_lead', $3, 'sales', 'Senior Account Executive'),
      ('customer_user', $4, 'customer', 'Apex Manufacturing Client'),
      ('client_titan', $4, 'customer', 'Titan Industries Client')
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        full_name = EXCLUDED.full_name;
    `,
      [adminHash, opsHash, salesHash, customerHash]
    );

    // Insert Inventory
    await client.query(`
      INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
      VALUES
      ('Steel Rods', 'Raw Material', 'Warehouse A', 'BATCH-001', 500, 50),
      ('Steel Rods', 'Raw Material', 'Warehouse B', 'BATCH-001', 200, 0),
      ('Copper Wire', 'Electrical', 'Warehouse A', 'BATCH-002', 1000, 200),
      ('Copper Wire', 'Electrical', 'Warehouse C', 'BATCH-002', 300, 0),
      ('PVC Pipe', 'Plumbing', 'Warehouse B', 'BATCH-003', 800, 100),
      ('Circuit Board', 'Electronics', 'Warehouse A', 'BATCH-004', 150, 30),
      ('Hydraulic Pump', 'Machinery', 'Warehouse C', 'BATCH-005', 25, 5)
      ON CONFLICT (item, location, batch) DO NOTHING
    `);

    // Insert Customer Orders
    await client.query(`
      INSERT INTO customer_orders (order_id, customer_name, item, location, qty, status, created_by_username)
      VALUES
      ('ORD-1001', 'Apex Manufacturing', 'Steel Rods', 'Warehouse A', 50, 'Reserved', 'sales_user'),
      ('ORD-1002', 'Global Dynamics', 'Copper Wire', 'Warehouse A', 200, 'Reserved', 'sales_lead'),
      ('ORD-1003', 'Titan Industries', 'PVC Pipe', 'Warehouse B', 100, 'Reserved', 'sales_user'),
      ('ORD-1004', 'Cyberdyne Systems', 'Circuit Board', 'Warehouse A', 30, 'Reserved', 'sales_user'),
      ('ORD-1005', 'Stark Enterprises', 'Hydraulic Pump', 'Warehouse C', 5, 'Reserved', 'sales_lead'),
      ('ORD-1006', 'Wayne Enterprises', 'Copper Wire', 'Warehouse C', 80, 'Fulfilled', 'sales_user'),
      ('ORD-1007', 'Horizon Aerospace', 'Steel Rods', 'Warehouse B', 25, 'Pending', 'customer_user')
      ON CONFLICT (order_id) DO NOTHING
    `);

    // Insert Work Orders
    await client.query(`
      INSERT INTO work_orders (work_order_id, location, item, required_qty, assigned_username, status, shortage_qty, notes)
      VALUES
      ('WO-1001', 'Warehouse A', 'Steel Rods', 100, 'ops_user', 'In Progress', 0, 'Standard production run'),
      ('WO-1002', 'Warehouse B', 'PVC Pipe', 150, 'ops_lead', 'Assigned', 0, 'Plumbing replenishment'),
      ('WO-1003', 'Warehouse C', 'Hydraulic Pump', 10, 'ops_user', 'Completed', 0, 'Heavy machinery assembly')
      ON CONFLICT (work_order_id) DO NOTHING
    `);

    // Insert Internal Transfers
    await client.query(`
      INSERT INTO internal_transfers (transfer_id, source_location, destination_location, item, qty, status)
      VALUES
      ('TRF-5001', 'Warehouse A', 'Warehouse B', 'Steel Rods', 50, 'Dispatched'),
      ('TRF-5002', 'Warehouse B', 'Warehouse C', 'PVC Pipe', 100, 'Received'),
      ('TRF-5003', 'Warehouse C', 'Warehouse A', 'Copper Wire', 20, 'Requested')
      ON CONFLICT (transfer_id) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Seeding completed successfully!');
    console.log('\nDefault credentials:');
    console.log('  Admin:       admin / admin123');
    console.log('  Operations:  ops_user / ops123, ops_lead / ops123');
    console.log('  Sales:       sales_user / sales123, sales_lead / sales123');
    console.log('  Customers:   customer_user / customer123, client_titan / customer123\n');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Database setup failed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase();
