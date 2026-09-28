// ════════════════════════════════════════════════════════════════════
// db-reset.js — SVUOTA IL DATABASE (tutte le tabelle, schema compreso)
// ════════════════════════════════════════════════════════════════════
//   npm run db:reset -- --conferma
// Serve in sviluppo, per esempio prima di rifare l'import. Lo schema viene
// ricreato dalle migrazioni al prossimo avvio (o subito, qui sotto).
// ════════════════════════════════════════════════════════════════════

import { pool } from '../src/db/pool.js';
import { applicaMigrazioni } from '../src/db/migrate.js';

if (!process.argv.includes('--conferma')) {
  const { host, pathname } = new URL(process.env.DATABASE_URL);
  console.error(`Cancella TUTTI i dati di ${host}${pathname}. Per procedere: npm run db:reset -- --conferma`);
  process.exit(1);
}

try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await applicaMigrazioni();
  console.log('[DB] Database svuotato e schema ricreato.');
} finally {
  await pool.end();
}
