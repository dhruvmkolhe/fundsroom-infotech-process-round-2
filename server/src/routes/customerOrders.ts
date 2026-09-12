import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db';
import { authenticate, authorize } from '../middleware/auth';
import { handleValidation } from '../middleware/validate';

const router = Router();

// GET /customer-orders
router.get('/', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query('SELECT * FROM customer_orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /customer-orders - sales, admin, or customer creates reservation
router.post('/', authenticate, authorize('sales', 'admin', 'customer'),
  body('customer_name').trim().notEmpty(),
  body('item').trim().notEmpty(),
  body('location').trim().notEmpty(),
  body('qty').isFloat({ gt: 0 }).withMessage('qty must be > 0'),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { customer_name, item, location, qty } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // SELECT FOR UPDATE prevents concurrent over-reservation
      const invResult = await client.query(
        `SELECT id, (physical_qty - reserved_qty) AS available_qty
         FROM inventory WHERE item = $1 AND location = $2 FOR UPDATE`,
        [item, location]
      );

      if (invResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'No inventory found for this item at this location' });
        return;
      }

      const totalAvailable = invResult.rows.reduce((sum: number, r: any) => sum + Number(r.available_qty), 0);
      if (totalAvailable < Number(qty)) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: `Insufficient available inventory. Available: ${totalAvailable}, Requested: ${qty}`
        });
        return;
      }

      // Atomically increment reserved_qty
      let remaining = Number(qty);
      for (const row of invResult.rows) {
        if (remaining <= 0) break;
        const toReserve = Math.min(remaining, Number(row.available_qty));
        await client.query(
          'UPDATE inventory SET reserved_qty = reserved_qty + $1 WHERE id = $2',
          [toReserve, row.id]
        );
        remaining -= toReserve;
      }

      const orderId = `ORD-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO customer_orders (order_id, customer_name, item, location, qty, status, created_by_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5, 'Reserved', $6, $7) RETURNING *`,
        [orderId, customer_name, item, location, qty, req.user!.userId, req.user!.username]
      );

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  }
);

// PATCH /customer-orders/:id/cancel - release reservation
router.patch('/:id/cancel', authenticate, authorize('sales', 'admin'),
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const order = await client.query(
        'SELECT * FROM customer_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!order.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      const o = order.rows[0];
      if (o.status !== 'Reserved') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Cannot cancel order with status ${o.status}` });
        return;
      }

      // Release reservation
      await client.query(
        `UPDATE inventory SET reserved_qty = GREATEST(0, reserved_qty - $1)
         WHERE item = $2 AND location = $3`,
        [o.qty, o.item, o.location]
      );

      const result = await client.query(
        "UPDATE customer_orders SET status = 'Cancelled' WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  }
);

export default router;
