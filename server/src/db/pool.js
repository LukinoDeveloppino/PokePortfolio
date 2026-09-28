// ════════════════════════════════════════════════════════════════════
// pool.js — CONNESSIONE A POSTGRESQL
// ════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { config } from '../config.js';

// NUMERIC (prezzi) arriva dal driver come stringa per non perdere
// precisione: per importi in euro con 2 decimali un Number basta.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valore) => parseFloat(valore));
// COUNT(*) e SUM su interi restituiscono BIGINT: le quantità non superano
// mai 2^53, quindi le converto anche queste.
pg.types.setTypeParser(pg.types.builtins.INT8, (valore) => parseInt(valore, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10
});

// Esegue fn(client) dentro una transazione: COMMIT se va a buon fine,
// ROLLBACK (e rilancio dell'errore) altrimenti.
export async function transazione(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const risultato = await fn(client);
    await client.query('COMMIT');
    return risultato;
  } catch (errore) {
    await client.query('ROLLBACK');
    throw errore;
  } finally {
    client.release();
  }
}
