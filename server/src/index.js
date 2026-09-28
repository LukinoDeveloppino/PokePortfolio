// ════════════════════════════════════════════════════════════════════
// index.js — AVVIO DEL SERVER
// ════════════════════════════════════════════════════════════════════

import { config } from './config.js';
import { pool } from './db/pool.js';
import { applicaMigrazioni } from './db/migrate.js';
import { buildApp } from './app.js';

const app = buildApp();

await applicaMigrazioni(app.log);
await app.listen({ port: config.port, host: config.host });

// I PaaS fermano il processo con SIGTERM durante deploy e riavvii:
// chiudo prima le richieste in corso, poi le connessioni al database.
for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.once(segnale, async () => {
    app.log.info(`${segnale} ricevuto, arresto in corso`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
