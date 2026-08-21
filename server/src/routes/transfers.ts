import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db';
import { authenticate, authorize } from '../middleware/auth';
import { handleValidation } from '../middleware/validate';

const router = Router();

// GET /transfers
router.get('/', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query('SELECT * FROM internal_transfers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /transfers - create a new transfer request
router.post('/', authenticate, authorize('admin', 'operations'),
  body('source_location').trim().notEmpty(),
  body('destination_location').trim().notEmpty(),
  body('item').trim().notEmpty(),
  body('qty').isFloat({ gt: 0 }).withMessage('qty must be > 0'),
  body('work_order_id').optional().trim(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { source_location, destination_location, item, qty, work_order_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check available qty at source
      const invResult = await client.query(
        'SELECT (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE item = $1 AND location = $2 FOR UPDATE',
        [item, source_location]
      );
      const available = invResult.rows.reduce((sum: number, r: any) => sum + Number(r.available_qty), 0);
      if (available < Number(qty)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Insufficient inventory. Available: ${available}, Requested: ${qty}` });
        return;
      }

      const transferId = `TRF-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO internal_transfers (transfer_id, source_location, destination_location, item, qty, work_order_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [transferId, source_location, destination_location, item, qty, work_order_id || null]
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

// PATCH /transfers/:id/dispatch - reduce source inventory
router.patch('/:id/dispatch', authenticate, authorize('admin', 'operations'),
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const transfer = await client.query(
        'SELECT * FROM internal_transfers WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!transfer.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Transfer not found' });
        return;
      }
      const t = transfer.rows[0];
      if (t.status !== 'Requested') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Cannot dispatch: transfer is already ${t.status}` });
        return;
      }

      // Reduce source inventory (physical_qty)
      const invUpdate = await client.query(
        `UPDATE inventory SET physical_qty = physical_qty - $1
         WHERE item = $2 AND location = $3 AND (physical_qty - reserved_qty) >= $1
         RETURNING id`,
        [t.qty, t.item, t.source_location]
      );
      if (invUpdate.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Insufficient available inventory at source to dispatch' });
        return;
      }

      const result = await client.query(
        `UPDATE internal_transfers SET status = 'Dispatched', dispatched_at = NOW()
         WHERE id = $1 RETURNING *`,
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

// PATCH /transfers/:id/receive - increase destination inventory, prevent double receipt
router.patch('/:id/receive', authenticate, authorize('admin', 'operations'),
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const transfer = await client.query(
        'SELECT * FROM internal_transfers WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!transfer.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Transfer not found' });
        return;
      }
      const t = transfer.rows[0];
      if (t.status === 'Received') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Transfer has already been received (duplicate receipt prevented)' });
        return;
      }
      if (t.status !== 'Dispatched') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Cannot receive: transfer status is ${t.status}. Must be Dispatched first.` });
        return;
      }

      // Upsert into destination inventory
      await client.query(
        `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
         SELECT $1, i.category, $2, $3, $4, 0
         FROM inventory i WHERE i.item = $1 LIMIT 1
         ON CONFLICT (item, location, batch) DO UPDATE
         SET physical_qty = inventory.physical_qty + EXCLUDED.physical_qty`,
        [t.item, t.destination_location, 'DEFAULT', t.qty]
      );

      const result = await client.query(
        `UPDATE internal_transfers SET status = 'Received', received_at = NOW()
         WHERE id = $1 RETURNING *`,
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
