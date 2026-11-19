import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { initSocket } from './services/socket.js';
import { seedSkillsIfNeeded } from './services/skillSeedService.js';
import { ensureStudentIdNumbers } from './utils/helpers.js';
import apiRoutes from './routes/index.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow local development and tools
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads serving
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadDir));

// Mount API routes
app.use('/api', apiRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('<h1>ProjectLink API is running perfectly!</h1>');
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : undefined,
  });
});

// Initialize real-time WebSocket
initSocket(server);

// Start server
async function start() {
  await connectDB();
  await seedSkillsIfNeeded();
  await ensureStudentIdNumbers();
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` ProjectLink API Server running at http://localhost:${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(` Static Uploads: http://localhost:${PORT}/uploads`);
    console.log(` API Base: http://localhost:${PORT}/api`);
    console.log(`=======================================================`);
  });
}

start();

export { app, server };
