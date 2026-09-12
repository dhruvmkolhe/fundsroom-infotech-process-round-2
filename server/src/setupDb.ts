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

    // 2. Seed initial data
    console.log('🌱 Seeding initial users and inventory...');
    await client.query('BEGIN');

    const adminHash = await bcrypt.hash('admin123', 10);
    const opsHash = await bcrypt.hash('ops123', 10);
    const salesHash = await bcrypt.hash('sales123', 10);

    await client.query(
      `
      INSERT INTO users (username, password_hash, role, full_name) VALUES
      ('admin', $1, 'admin', 'System Administrator'),
      ('ops_user', $2, 'operations', 'Operations Manager'),
      ('sales_user', $3, 'sales', 'Sales Representative')
      ON CONFLICT (username) DO NOTHING
    `,
      [adminHash, opsHash, salesHash]
    );

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

    await client.query('COMMIT');
    console.log('✅ Seeding completed successfully!');
    console.log('\nDefault credentials:');
    console.log('  Admin:       admin / admin123');
    console.log('  Operations:  ops_user / ops123');
    console.log('  Sales:       sales_user / sales123\n');
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
