// ════════════════════════════════════════════════════════════════════
// db-local.js — POSTGRESQL LOCALE SENZA DOCKER
// ════════════════════════════════════════════════════════════════════
// Scarica (tramite npm) ed esegue un vero PostgreSQL con i dati in
// ./data/postgres. Resta in primo piano: Ctrl+C per fermarlo.
// Stesse credenziali di docker-compose.yml e .env.example.
// ════════════════════════════════════════════════════════════════════

import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CARTELLA_DATI = path.resolve('data', 'postgres');
const NOME_DB = 'pokeportfolio';

const PORTA = Number(process.env.DB_LOCAL_PORT || 5432);

const pg = new EmbeddedPostgres({
  databaseDir: CARTELLA_DATI,
  user:        'pokeportfolio',
  password:    'pokeportfolio',
  port:        PORTA,
  persistent:  true
});

const primoAvvio = !existsSync(path.join(CARTELLA_DATI, 'PG_VERSION'));
if (primoAvvio) await pg.initialise();
await pg.start();
if (primoAvvio) await pg.createDatabase(NOME_DB);

console.log(`[DB] PostgreSQL in ascolto su localhost:${PORTA}, dati in ${CARTELLA_DATI}`);
console.log('[DB] Ctrl+C per fermarlo.');

for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.once(segnale, async () => {
    await pg.stop();
    process.exit(0);
  });
}
