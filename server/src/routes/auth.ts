import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db';
import { handleValidation } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /auth/login
router.post('/login',
  body('username').trim().notEmpty().withMessage('Username required'),
  body('password').notEmpty().withMessage('Password required'),
  handleValidation,
  async (req: Request, res: Response): Promise<void> => {
    const { username, password } = req.body;
    try {
      const result = await pool.query(
        'SELECT id, username, password_hash, role, full_name FROM users WHERE username = $1',
        [username]
      );
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET || 'mini-erp-secret-key-2024',
        { expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as any }
      );
      res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// GET /auth/me
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, full_name FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
