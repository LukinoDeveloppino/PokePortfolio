// ════════════════════════════════════════════════════════════════════
// job.js — LANCIA A MANO UN JOB E NE ATTENDE LA FINE
// ════════════════════════════════════════════════════════════════════
//   npm run job -- catalog-sync      scarica i set nuovi
//   npm run job -- catalog-refresh   ricontrolla tutti i set
//   npm run job -- prices            aggiorna i prezzi di tutti gli utenti
// ════════════════════════════════════════════════════════════════════

import { pool } from '../src/db/pool.js';
import { applicaMigrazioni } from '../src/db/migrate.js';
import { avviaSyncCatalogo } from '../src/services/catalog.js';
import { avviaAggiornamentoPrezzi } from '../src/services/prices.js';

const JOB = {
  'catalog-sync':    () => avviaSyncCatalogo({ mode: 'sync' }),
  'catalog-refresh': () => avviaSyncCatalogo({ mode: 'refresh' }),
  prices:            () => avviaAggiornamentoPrezzi()
};

const nome = process.argv[2];
if (!Object.hasOwn(JOB, nome || '')) {
  console.error(`Uso: npm run job -- <${Object.keys(JOB).join('|')}>`);
  process.exit(1);
}

let codiceUscita = 0;
try {
  await applicaMigrazioni();
  const { avviato, completata } = await JOB[nome]();
  if (!avviato) {
    console.error(`[JOB] ${nome}: un'esecuzione è già in corso.`);
    codiceUscita = 1;
  } else {
    await completata;
  }
} catch (errore) {
  console.error(`[JOB] ${nome} fallito: ${errore.message}`);
  codiceUscita = 1;
} finally {
  await pool.end();
}
process.exit(codiceUscita);
