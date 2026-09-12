import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import inventoryRoutes from './routes/inventory';
import workOrderRoutes from './routes/workOrders';
import transferRoutes from './routes/transfers';
import customerOrderRoutes from './routes/customerOrders';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS: allow requests from anywhere (deployed Render domain, Vercel, localhost)
app.use(cors());
app.use(express.json());

// Create API Router for full Vercel Serverless and Express compatibility
const apiRouter = express.Router();

// Health check with database connectivity probe
apiRouter.get('/health', async (_req, res) => {
  let dbStatus = 'disconnected';
  if (process.env.DATABASE_URL) {
    try {
      const pool = (await import('./db')).default;
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch (e: any) {
      dbStatus = `error: ${e.message}`;
    }
  } else {
    dbStatus = 'DATABASE_URL not configured';
  }

  res.json({
    status: 'ok',
    database: dbStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/work-orders', workOrderRoutes);
apiRouter.use('/transfers', transferRoutes);
apiRouter.use('/customer-orders', customerOrderRoutes);

// Mount router under both /api and root so rewrites without prefix stripping both work
app.use('/api', apiRouter);
app.use('/', apiRouter);

import path from 'path';
import fs from 'fs';

// Serve frontend static assets if dist exists
const possibleDistPaths = [
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd(), 'server/dist'),
];
const distPath = possibleDistPaths.find(p => fs.existsSync(p)) || path.resolve(process.cwd(), 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// SPA fallback for all non-API GET requests
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

// 404 handler for unmatched API routes
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mini ERP Server running on port ${PORT}`);

    // Keep-alive pinger for Render free-tier
    const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
    if (serverUrl) {
      console.log(`📡 Keep-alive cron enabled for ${serverUrl}/health (every 10 min)`);
      setInterval(() => {
        fetch(`${serverUrl}/health`)
          .then((res) => console.log(`[Keep-Alive Ping] Status: ${res.status}`))
          .catch((err) => console.error('[Keep-Alive Ping Error]', err.message));
      }, 10 * 60 * 1000); // 10 minutes
    }
  });
}

export default app;
