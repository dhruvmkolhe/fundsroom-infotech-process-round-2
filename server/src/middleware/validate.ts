import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export function handleValidation(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return;
  }
  next();
}
