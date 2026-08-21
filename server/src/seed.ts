import bcrypt from 'bcryptjs';
import pool from './db';
import dotenv from 'dotenv';
dotenv.config();

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create users
    const adminHash = await bcrypt.hash('admin123', 10);
    const opsHash = await bcrypt.hash('ops123', 10);
    const salesHash = await bcrypt.hash('sales123', 10);

    await client.query(`
      INSERT INTO users (username, password_hash, role, full_name) VALUES
      ('admin', $1, 'admin', 'System Administrator'),
      ('ops_user', $2, 'operations', 'Operations Manager'),
      ('sales_user', $3, 'sales', 'Sales Representative')
      ON CONFLICT (username) DO NOTHING
    `, [adminHash, opsHash, salesHash]);

    // Create inventory
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
    console.log('Seed completed successfully');
    console.log('Users: admin/admin123, ops_user/ops123, sales_user/sales123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
