import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app';
import { getServerSecrets, isProduction, simulationRoutesEnabled } from './server/config';
import { adminAuth, adminDb, FieldValue } from './server/firebaseAdmin';
import { logger } from './server/logger';
import type { FieldValueLike, FirestoreLike } from './server/types';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: isProduction ? 'production' : 'development',
    tracesSampleRate: 0.1,
  });
}

async function startServer() {
  const app = createApp({
    verifyIdToken: async (idToken: string) => {
      const decoded = await adminAuth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email,
        email_verified: decoded.email_verified,
      };
    },
    db: adminDb as unknown as FirestoreLike,
    fieldValue: FieldValue as unknown as FieldValueLike,
    now: () => Date.now(),
    getSecrets: getServerSecrets,
    isProduction,
    simulationRoutesEnabled,
    logger,
  });

  const distPath = path.resolve(__dirname, 'dist');
  const distIndexExists = fs.existsSync(path.join(distPath, 'index.html'));
  if (!isProduction || (process.env.NODE_ENV !== 'production' && !distIndexExists)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build introuvable. Exécutez npm run build.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, isProduction }, 'PayReminder server listening');
  });
}

void startServer();
