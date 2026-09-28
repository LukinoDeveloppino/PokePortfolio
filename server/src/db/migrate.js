// ════════════════════════════════════════════════════════════════════
// migrate.js — MIGRAZIONI DELLO SCHEMA
// ════════════════════════════════════════════════════════════════════
// I file in migrations/ (NNN_nome.sql) vengono applicati in ordine, una
// sola volta ciascuno, ognuno nella propria transazione. Quelli già
// applicati sono registrati in schema_migrations.
//
// Gira in automatico all'avvio del server; `npm run migrate` lo lancia
// da solo.
// ════════════════════════════════════════════════════════════════════

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, transazione } from './pool.js';

const CARTELLA_MIGRAZIONI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Numero arbitrario ma fisso: impedisce a due istanze del server avviate
// insieme (es. durante un deploy) di applicare le migrazioni due volte.
const ID_LOCK_MIGRAZIONI = 7_310_245;

export async function applicaMigrazioni(log = console) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ID_LOCK_MIGRAZIONI]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const giaApplicate = new Set(rows.map((r) => r.name));

    const file = (await readdir(CARTELLA_MIGRAZIONI)).filter((f) => f.endsWith('.sql')).sort();
    for (const nome of file) {
      if (giaApplicate.has(nome)) continue;
      const sql = await readFile(path.join(CARTELLA_MIGRAZIONI, nome), 'utf8');
      await transazione(async (tx) => {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [nome]);
      });
      log.info(`[MIGRATE] Applicata ${nome}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ID_LOCK_MIGRAZIONI]).catch(() => {});
    client.release();
  }
}

// Esecuzione diretta: `npm run migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await applicaMigrazioni();
    console.log('[MIGRATE] Schema aggiornato.');
  } finally {
    await pool.end();
  }
}
