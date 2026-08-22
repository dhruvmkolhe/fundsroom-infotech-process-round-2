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

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

import path from 'path';
import fs from 'fs';

// Serve frontend static assets if dist exists
const possibleDistPaths = [
  path.resolve(process.cwd(), 'dist'),
  path.resolve(__dirname, '../../dist'),
  path.resolve(__dirname, '../dist'),
];
const distPath = possibleDistPaths.find(p => fs.existsSync(p)) || path.resolve(process.cwd(), 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/work-orders', workOrderRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/customer-orders', customerOrderRoutes);

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

if (require.main === module) {
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
