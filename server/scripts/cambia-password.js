// ════════════════════════════════════════════════════════════════════
// cambia-password.js — IMPOSTA UNA NUOVA PASSWORD A UN UTENTE
// ════════════════════════════════════════════════════════════════════
//   node --env-file=.env server/scripts/cambia-password.js <username>
// Chiede la password due volte senza mostrarla, la salva come hash
// scrypt (come la registrazione) e chiude tutte le sessioni dell'utente.
// Sul server si lancia dal PC con: npm run password -- <username>
// ════════════════════════════════════════════════════════════════════

import { pool } from '../src/db/pool.js';
import { calcolaHashPassword } from '../src/services/auth.js';

const LUNGHEZZA_MINIMA = 8;

// Legge una riga dal terminale senza farla vedere.
function chiediNascosto(domanda) {
  return new Promise((risolvi, rifiuta) => {
    const ingresso = process.stdin;
    if (!ingresso.isTTY) {
      rifiuta(new Error('Serve un terminale interattivo (con ssh usa l\'opzione -t).'));
      return;
    }
    process.stdout.write(domanda);
    ingresso.setRawMode(true);
    ingresso.resume();
    ingresso.setEncoding('utf8');
    let testo = '';
    const leggi = (caratteri) => {
      for (const c of caratteri) {
        if (c === '\r' || c === '\n') {
          ingresso.setRawMode(false);
          ingresso.pause();
          ingresso.removeListener('data', leggi);
          process.stdout.write('\n');
          risolvi(testo);
          return;
        }
        if (c === '\u0003') { // Ctrl+C
          ingresso.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') testo = testo.slice(0, -1);
        else testo += c;
      }
    };
    ingresso.on('data', leggi);
  });
}

const username = String(process.argv[2] || '').trim();
let codiceUscita = 0;

try {
  if (!username) throw new Error('Uso: cambia-password.js <username>');

  const { rows } = await pool.query(
    'SELECT id, username FROM users WHERE lower(username) = lower($1)', [username]
  );
  if (!rows.length) throw new Error(`Utente "${username}" non trovato.`);
  const utente = rows[0];

  const password = await chiediNascosto(`Nuova password per ${utente.username}: `);
  if (password.length < LUNGHEZZA_MINIMA) {
    throw new Error(`La password deve avere almeno ${LUNGHEZZA_MINIMA} caratteri.`);
  }
  if (await chiediNascosto('Ripetila: ') !== password) {
    throw new Error('Le due password non coincidono: niente è stato cambiato.');
  }

  await pool.query(
    `UPDATE users SET password_hash = $2, hash_algo = 'scrypt' WHERE id = $1`,
    [utente.id, await calcolaHashPassword(password)]
  );
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1', [utente.id]);
  console.log(`Password di ${utente.username} cambiata. Sessioni chiuse: ${rowCount}.`);
} catch (errore) {
  console.error(errore.message);
  codiceUscita = 1;
} finally {
  await pool.end();
}
process.exit(codiceUscita);
