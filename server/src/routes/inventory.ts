import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import pool from '../db';
import { authenticate, authorize } from '../middleware/auth';
import { handleValidation } from '../middleware/validate';

const router = Router();

// GET /inventory - list all inventory (all authenticated roles)
router.get('/', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT *, (physical_qty - reserved_qty) AS available_qty FROM inventory ORDER BY location, item'
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /inventory/:id
router.get('/:id', authenticate,
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query(
        'SELECT *, (physical_qty - reserved_qty) AS available_qty FROM inventory WHERE id = $1',
        [req.params.id]
      );
      if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// POST /inventory - admin or operations only
router.post('/', authenticate, authorize('admin', 'operations'),
  body('item').trim().notEmpty(),
  body('category').trim().notEmpty(),
  body('location').trim().notEmpty(),
  body('physical_qty').isFloat({ min: 0 }).withMessage('physical_qty must be >= 0'),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { item, category, location, batch = 'DEFAULT', physical_qty } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO inventory (item, category, location, batch, physical_qty, reserved_qty)
         VALUES ($1, $2, $3, $4, $5, 0)
         RETURNING *, (physical_qty - reserved_qty) AS available_qty`,
        [item, category, location, batch, physical_qty]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'Inventory record already exists for this item/location/batch combination' });
        return;
      }
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PUT /inventory/:id - update physical qty
router.put('/:id', authenticate, authorize('admin', 'operations'),
  param('id').isUUID(),
  body('physical_qty').optional().isFloat({ min: 0 }),
  body('category').optional().trim().notEmpty(),
  body('location').optional().trim().notEmpty(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { physical_qty, category, location } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT * FROM inventory WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const inv = current.rows[0];
      const newPhysical = physical_qty !== undefined ? Number(physical_qty) : inv.physical_qty;
      if (newPhysical < inv.reserved_qty) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Cannot set physical_qty below reserved_qty (${inv.reserved_qty})` });
        return;
      }
      const result = await client.query(
        `UPDATE inventory SET
          physical_qty = $1, category = COALESCE($2, category), location = COALESCE($3, location)
         WHERE id = $4
         RETURNING *, (physical_qty - reserved_qty) AS available_qty`,
        [newPhysical, category, location, req.params.id]
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

// DELETE /inventory/:id - admin only
router.delete('/:id', authenticate, authorize('admin'),
  param('id').isUUID(),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query('DELETE FROM inventory WHERE id = $1 RETURNING id', [req.params.id]);
      if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ message: 'Deleted successfully' });
    } catch {
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;
