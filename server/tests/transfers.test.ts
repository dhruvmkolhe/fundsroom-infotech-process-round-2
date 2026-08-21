import request from 'supertest';
import app from '../src/index';
import pool from '../src/db';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

function makeAdminToken(): string {
  return jwt.sign(
    { userId: 'admin-test-id', username: 'test_admin', role: 'admin' },
    process.env.JWT_SECRET || 'test_secret',
    { expiresIn: '1h' }
  );
}

describe('Internal Transfer Tests', () => {
  let adminToken: string;
  let transferId: string;
  let sourceInventoryId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_secret';
    adminToken = makeAdminToken();

    const hash = await bcrypt.hash('test123', 10);
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role) VALUES ('admin-test-id', 'test_admin', $1, 'admin')
       ON CONFLICT DO NOTHING`,
      [hash]
    );

    // Create source inventory
    const inv = await pool.query(
      `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
       VALUES ('Transfer Item', 'Test', 'Source Loc', 'BATCH-TRF', 100, 0)
       ON CONFLICT (item, location, batch) DO UPDATE SET physical_qty = 100, reserved_qty = 0
       RETURNING id`
    );
    sourceInventoryId = inv.rows[0].id;

    // Ensure dest location exists (will be upserted on receive)
  });

  afterAll(async () => {
    await pool.query("DELETE FROM internal_transfers WHERE item = 'Transfer Item'");
    await pool.query("DELETE FROM inventory WHERE item = 'Transfer Item'");
    await pool.query("DELETE FROM users WHERE id IN ('admin-test-id')");
    await pool.end();
  });

  // Test 2: Cannot transfer more than available inventory
  test('TEST 2: Cannot transfer more than available inventory', async () => {
    const res = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        source_location: 'Source Loc',
        destination_location: 'Dest Loc',
        item: 'Transfer Item',
        qty: 9999
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  test('Create a valid transfer', async () => {
    const res = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        source_location: 'Source Loc',
        destination_location: 'Dest Loc',
        item: 'Transfer Item',
        qty: 10
      });
    expect(res.status).toBe(201);
    transferId = res.body.id;
    expect(res.body.status).toBe('Requested');
  });

  test('Dispatch the transfer', async () => {
    const res = await request(app)
      .patch(`/api/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Dispatched');

    // Source inventory should have decreased
    const inv = await pool.query('SELECT physical_qty FROM inventory WHERE id = $1', [sourceInventoryId]);
    expect(Number(inv.rows[0].physical_qty)).toBe(90);
  });

  // Test 3: Destination stock increases only after receipt
  test('TEST 3: Destination stock does NOT increase before receipt', async () => {
    // Transfer is Dispatched but not yet Received
    const destInv = await pool.query(
      "SELECT physical_qty FROM inventory WHERE item = 'Transfer Item' AND location = 'Dest Loc'"
    );
    // Should not exist yet, or qty should be 0
    const destQty = destInv.rows[0] ? Number(destInv.rows[0].physical_qty) : 0;
    expect(destQty).toBe(0);
  });

  test('Receive the transfer (destination increases)', async () => {
    const res = await request(app)
      .patch(`/api/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Received');

    // Destination inventory should now have the quantity
    const destInv = await pool.query(
      "SELECT physical_qty FROM inventory WHERE item = 'Transfer Item' AND location = 'Dest Loc'"
    );
    expect(Number(destInv.rows[0].physical_qty)).toBe(10);
  });

  // Test 4: Same transfer cannot be received twice
  test('TEST 4: Cannot receive same transfer twice', async () => {
    const res = await request(app)
      .patch(`/api/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been received/i);
  });
});
