// ════════════════════════════════════════════════════════════════════
// app.js — COSTRUZIONE DELL'APP FASTIFY
// ════════════════════════════════════════════════════════════════════
// Separata da index.js così i test possono creare l'app e interrogarla
// con app.inject() senza aprire una porta.
// ════════════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import { pool } from './db/pool.js';

export function buildApp(opzioni = {}) {
  const app = Fastify({ logger: opzioni.logger ?? true });

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

  return app;
}
