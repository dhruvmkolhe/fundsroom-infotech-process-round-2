import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db';
import { authenticate, authorize } from '../middleware/auth';
import { handleValidation } from '../middleware/validate';

const router = Router();

// GET /work-orders
router.get('/', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query('SELECT * FROM work_orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /work-orders/:id
router.get('/:id', authenticate,
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query('SELECT * FROM work_orders WHERE id = $1', [req.params.id]);
      if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// POST /work-orders - admin only
router.post('/', authenticate, authorize('admin'),
  body('location').trim().notEmpty(),
  body('item').trim().notEmpty(),
  body('required_qty').isFloat({ gt: 0 }).withMessage('required_qty must be > 0'),
  body('assigned_user_id').optional().isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { location, item, required_qty, assigned_user_id, notes } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get inventory at location for shortage calculation
      const invResult = await client.query(
        'SELECT (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE item = $1 AND location = $2',
        [item, location]
      );
      const availableQty = invResult.rows.reduce((sum: number, r: any) => sum + Number(r.available_qty), 0);
      const shortage = Math.max(0, Number(required_qty) - availableQty);

      let assignedUsername: string | null = null;
      if (assigned_user_id) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [assigned_user_id]);
        assignedUsername = userRes.rows[0]?.username || null;
      }

      const workOrderId = `WO-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO work_orders (work_order_id, location, item, required_qty, assigned_user_id, assigned_username, shortage_qty, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [workOrderId, location, item, required_qty, assigned_user_id || null, assignedUsername, shortage, notes || null]
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

// PATCH /work-orders/:id/status - operations can update status
router.patch('/:id/status', authenticate, authorize('admin', 'operations'),
  param('id').isUUID(),
  body('status').isIn(['Assigned', 'In Progress', 'Completed']).withMessage('Invalid status'),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query(
        'UPDATE work_orders SET status = $1 WHERE id = $2 RETURNING *',
        [req.body.status, req.params.id]
      );
      if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;
