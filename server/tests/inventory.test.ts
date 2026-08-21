import request from 'supertest';
import app from '../src/index';
import pool from '../src/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Helper to generate test tokens
function makeToken(role: 'admin' | 'operations' | 'sales'): string {
  return jwt.sign(
    { userId: 'test-user-id', username: `test_${role}`, role },
    process.env.JWT_SECRET || 'test_secret',
    { expiresIn: '1h' }
  );
}

describe('Inventory API', () => {
  let adminToken: string;
  let opsToken: string;
  let salesToken: string;
  let testInventoryId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_secret';
    adminToken = makeToken('admin');
    opsToken = makeToken('operations');
    salesToken = makeToken('sales');

    // Setup test inventory
    const res = await pool.query(
      `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
       VALUES ('Test Item', 'Test Cat', 'Test Location', 'BATCH-TEST', 100, 0)
       ON CONFLICT DO NOTHING RETURNING id`
    );
    if (res.rows[0]) testInventoryId = res.rows[0].id;
    else {
      const existing = await pool.query("SELECT id FROM inventory WHERE item = 'Test Item' AND location = 'Test Location'");
      testInventoryId = existing.rows[0]?.id;
    }
  });

  afterAll(async () => {
    await pool.query("DELETE FROM inventory WHERE item = 'Test Item'");
    await pool.end();
  });

  // Test 1: Cannot reserve more than available inventory
  test('TEST 1: Cannot reserve more than available inventory', async () => {
    // Get current available
    const inv = await pool.query(
      "SELECT physical_qty, reserved_qty FROM inventory WHERE id = $1",
      [testInventoryId]
    );
    const available = Number(inv.rows[0].physical_qty) - Number(inv.rows[0].reserved_qty);
    const overReserve = available + 999;

    // Ensure sales user exists
    const hash = await bcrypt.hash('test123', 10);
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role) VALUES ('test-user-id', 'test_sales', $1, 'sales')
       ON CONFLICT DO NOTHING`,
      [hash]
    );

    const salesJwt = jwt.sign(
      { userId: 'test-user-id', username: 'test_sales', role: 'sales' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/customer-orders')
      .set('Authorization', `Bearer ${salesJwt}`)
      .send({
        customer_name: 'Test Customer',
        item: 'Test Item',
        location: 'Test Location',
        qty: overReserve
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  // Test 5: Unauthorized user cannot perform restricted operation
  test('TEST 5: Sales user cannot create inventory (unauthorized)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        item: 'Unauthorized Item',
        category: 'Test',
        location: 'Warehouse X',
        physical_qty: 100
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  test('TEST 5b: Unauthenticated request is rejected', async () => {
    const res = await request(app).get('/api/inventory');
    expect(res.status).toBe(401);
  });
});
