// ════════════════════════════════════════════════════════════════════
// app.js — COSTRUZIONE DELL'APP FASTIFY
// ════════════════════════════════════════════════════════════════════
// Separata da index.js così i test possono creare l'app e interrogarla
// con app.inject() senza aprire una porta.
// ════════════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import { pool } from './db/pool.js';
import { rottaRpc } from './routes/rpc.js';
import { rottePagine } from './routes/pagine.js';
import { rotteCron } from './jobs/scheduler.js';

export function buildApp(opzioni = {}) {
  const app = Fastify({
    logger: opzioni.logger ?? true,
    // Dietro il proxy del PaaS l'IP del client arriva in X-Forwarded-For.
    trustProxy: true
  });

  // Stato del server e del database: usato dal PaaS per l'health check.
  app.get('/api/health', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch (errore) {
      request.log.error(errore, 'Database non raggiungibile');
      return reply.code(503).send({ status: 'error', database: 'unreachable' });
    }
  });

  app.register(rottaRpc);
  app.register(rottePagine);
  app.register(rotteCron);

  return app;
}
