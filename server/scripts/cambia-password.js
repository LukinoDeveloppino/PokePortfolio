// ════════════════════════════════════════════════════════════════════
// cambia-password.js — LINK PER REIMPOSTARE LA PASSWORD DI UN UTENTE
// ════════════════════════════════════════════════════════════════════
//   node --env-file=.env server/scripts/cambia-password.js <username>
// Stampa un link monouso, valido 24 ore, da mandare all'utente: dal link
// sceglie da solo la password nuova (vedi creaLinkReset in auth.js).
// Il codice sta dopo il # dell'indirizzo, quindi non arriva al server né
// finisce nei log. Indirizzo dell'app: URL_APP, altrimenti localhost.
// Sul server si lancia dal PC con: npm run password -- <username>
// ════════════════════════════════════════════════════════════════════

import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { creaLinkReset } from '../src/services/auth.js';

const username = String(process.argv[2] || '').trim();
const urlApp = (process.env.URL_APP || `http://localhost:${config.port}`).replace(/\/+$/, '');
let codiceUscita = 0;

try {
  if (!username) throw new Error('Uso: cambia-password.js <username>');

  const link = await creaLinkReset(username);
  console.log(`Link per reimpostare la password di ${link.username} (vale una volta, per 24 ore):`);
  console.log(`  ${urlApp}/#reset=${link.codice}`);
  console.log('Mandalo solo a lui: chi ha il link può cambiare la password. Il vecchio link, se c\'era, non vale più.');
} catch (errore) {
  console.error(errore.message);
  codiceUscita = 1;
} finally {
  await pool.end();
}
process.exit(codiceUscita);
