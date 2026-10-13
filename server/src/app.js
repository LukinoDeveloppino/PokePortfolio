// ════════════════════════════════════════════════════════════════════
// app.js — COSTRUZIONE DELL'APP FASTIFY
// ════════════════════════════════════════════════════════════════════
// Separata da index.js così i test possono creare l'app e interrogarla
// con app.inject() senza aprire una porta.
// ════════════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import limiteRichieste from '@fastify/rate-limit';
import { pool } from './db/pool.js';
import { config } from './config.js';
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

  // Limite ai tentativi di accesso e registrazione (vedi routes/rpc.js):
  // nessun limite globale, solo dove la rotta lo chiede.
  app.register(limiteRichieste, { global: false });
  app.register(rottaRpc, { limiteAccessiAlMinuto: opzioni.limiteAccessiAlMinuto ?? config.limiteAccessiAlMinuto });
  app.register(rottePagine);
  app.register(rotteCron);

  return app;
}
