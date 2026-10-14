// ════════════════════════════════════════════════════════════════════
// auth.js — REGISTRAZIONE, LOGIN E SESSIONI
// ════════════════════════════════════════════════════════════════════
// Porting di Script/Auth.js (tag v1.0-gas). Differenze rispetto alla versione GAS:
//   • le sessioni sono righe della tabella sessions, una per login: più
//     utenti (e più dispositivi) restano collegati insieme. In GAS erano
//     nelle UserProperties del proprietario, quindi ne esisteva una sola;
//   • le password sono salvate con scrypt e salt casuale. Gli hash SHA-256
//     importati da Sheets vengono convertiti al primo login riuscito.
// ════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, transazione } from '../db/pool.js';
import { ErroreApi, NonAutorizzato } from '../lib/errori.js';

const scryptAsync = promisify(scrypt);

const DURATA_SESSIONE_MS = 24 * 60 * 60 * 1000;
const DURATA_LINK_RESET_MS = 24 * 60 * 60 * 1000;
export const LUNGHEZZA_MINIMA_PASSWORD = 8;
const LUNGHEZZA_CHIAVE = 64;
const LUNGHEZZA_MINIMA_USERNAME = 3;
const VIOLAZIONE_UNICITA = '23505';


// ════════════════════════════════════════════════════════════════════
// HASH DELLE PASSWORD
// ════════════════════════════════════════════════════════════════════

// Formato salvato: 'salt:hash' in base64.
export async function calcolaHashPassword(password) {
  const salt = randomBytes(16);
  const chiave = await scryptAsync(password, salt, LUNGHEZZA_CHIAVE);
  return `${salt.toString('base64')}:${chiave.toString('base64')}`;
}

async function verificaPassword(password, hashSalvato, algoritmo) {
  if (algoritmo === 'sha256') {
    // Hash della versione GAS: SHA-256 esadecimale, senza salt.
    const calcolato = createHash('sha256').update(password, 'utf8').digest();
    return confrontaSicuro(calcolato, Buffer.from(hashSalvato, 'hex'));
  }
  const [salt, chiave] = hashSalvato.split(':').map((parte) => Buffer.from(parte, 'base64'));
  const calcolata = await scryptAsync(password, salt, chiave.length);
  return confrontaSicuro(calcolata, chiave);
}

function confrontaSicuro(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}


// ════════════════════════════════════════════════════════════════════
// REGISTRAZIONE
// ════════════════════════════════════════════════════════════════════

export async function register(username, password) {
  if (!username || !password) throw new ErroreApi('Nome utente e password sono obbligatori.');

  const nome = String(username).trim();
  if (nome.length < LUNGHEZZA_MINIMA_USERNAME) {
    throw new ErroreApi('Il nome utente deve avere almeno 3 caratteri.');
  }

  try {
    await pool.query(
      `INSERT INTO users (username, password_hash, hash_algo)
       VALUES ($1, $2, 'scrypt')`,
      [nome, await calcolaHashPassword(String(password))]
    );
  } catch (errore) {
    if (errore.code === VIOLAZIONE_UNICITA) throw new ErroreApi('Nome utente già in uso.');
    throw errore;
  }
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════
// PASSWORD DIMENTICATA E CAMBIO PASSWORD
// ════════════════════════════════════════════════════════════════════
// Chi dimentica la password chiede un link al proprietario, che lo crea
// con `npm run password -- <utente>` e glielo manda: l'utente sceglie da
// solo la password nuova. Il link vale una volta sola e per 24 ore; nel
// database c'è solo l'hash del codice (tabella password_resets).

const LINK_NON_VALIDO = 'Link non valido o scaduto: chiedine uno nuovo a chi gestisce l\'app.';

const hashCodice = (codice) => createHash('sha256').update(String(codice)).digest('hex');

function controllaNuovaPassword(password) {
  if (typeof password !== 'string' || password.length < LUNGHEZZA_MINIMA_PASSWORD) {
    throw new ErroreApi(`La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
  }
}

// Crea il codice del link per un utente e annulla quelli creati prima.
// { username, codice }: il codice va nel link e non viene salvato.
export async function creaLinkReset(username) {
  const { rows: [utente] } = await pool.query(
    'SELECT id, username FROM users WHERE lower(username) = lower($1)', [String(username || '').trim()]
  );
  if (!utente) throw new ErroreApi(`Utente "${username}" non trovato.`);

  const codice = randomBytes(32).toString('base64url');
  await transazione(async (tx) => {
    await tx.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()', [utente.id]);
    await tx.query(
      'INSERT INTO password_resets (code_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashCodice(codice), utente.id, new Date(Date.now() + DURATA_LINK_RESET_MS)]
    );
  });
  return { username: utente.username, codice };
}

// Per la pagina del link: a chi appartiene, se è ancora valido.
export async function getPasswordReset(codice) {
  const { rows: [riga] } = await pool.query(
    `SELECT u.username FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.code_hash = $1 AND r.expires_at > now()`,
    [hashCodice(codice)]
  );
  if (!riga) throw new ErroreApi(LINK_NON_VALIDO);
  return { success: true, username: riga.username };
}

// Imposta la password nuova, consuma il link e chiude tutte le sessioni.
export async function resetPassword(codice, nuovaPassword) {
  controllaNuovaPassword(nuovaPassword);
  const hash = await calcolaHashPassword(nuovaPassword);

  return transazione(async (tx) => {
    const { rows: [riga] } = await tx.query(
      'DELETE FROM password_resets WHERE code_hash = $1 AND expires_at > now() RETURNING user_id',
      [hashCodice(codice)]
    );
    if (!riga) throw new ErroreApi(LINK_NON_VALIDO);

    const { rows: [utente] } = await tx.query(
      `UPDATE users SET password_hash = $2, hash_algo = 'scrypt' WHERE id = $1 RETURNING username`,
      [riga.user_id, hash]
    );
    await tx.query('DELETE FROM password_resets WHERE user_id = $1', [riga.user_id]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [riga.user_id]);
    return { success: true, username: utente.username };
  });
}

// Cambio dall'app: serve la password attuale. Le altre sessioni
// dell'utente (altri dispositivi) vengono chiuse, questa resta aperta.
export async function changePassword(utente, tokenSessione, passwordAttuale, nuovaPassword) {
  const { rows: [riga] } = await pool.query(
    'SELECT password_hash, hash_algo FROM users WHERE id = $1', [utente.id]
  );
  if (!(await verificaPassword(String(passwordAttuale || ''), riga.password_hash, riga.hash_algo))) {
    throw new ErroreApi('La password attuale non è corretta.');
  }
  controllaNuovaPassword(nuovaPassword);
  const hash = await calcolaHashPassword(nuovaPassword);

  await transazione(async (tx) => {
    await tx.query(`UPDATE users SET password_hash = $2, hash_algo = 'scrypt' WHERE id = $1`, [utente.id, hash]);
    await tx.query('DELETE FROM password_resets WHERE user_id = $1', [utente.id]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [utente.id, tokenSessione]);
  });
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ════════════════════════════════════════════════════════════════════

export async function login(username, password) {
  if (!username || !password) throw new ErroreApi('Inserisci nome utente e password.');

  const { rows } = await pool.query(
    'SELECT id, username, password_hash, hash_algo FROM users WHERE lower(username) = lower($1)',
    [String(username).trim()]
  );
  const utente = rows[0];

  // Utente inesistente o password sbagliata → stesso messaggio generico.
  if (!utente || !(await verificaPassword(String(password), utente.password_hash, utente.hash_algo))) {
    throw new ErroreApi('Nome utente o password errati.');
  }

  if (utente.hash_algo !== 'scrypt') {
    await pool.query(
      `UPDATE users SET password_hash = $2, hash_algo = 'scrypt' WHERE id = $1`,
      [utente.id, await calcolaHashPassword(String(password))]
    );
  }

  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, utente.id, new Date(Date.now() + DURATA_SESSIONE_MS)]
  );
  // Pulizia delle sessioni scadute di tutti: poche righe, costo trascurabile.
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');

  return { success: true, token, username: utente.username };
}

export async function logout(token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [String(token)]);
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════
// SESSIONE
// ════════════════════════════════════════════════════════════════════

// Utente collegato al token, oppure null se il token non è valido o è
// scaduto.
export async function utenteDaToken(token) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

export async function richiediUtente(token) {
  const utente = await utenteDaToken(token);
  if (!utente) throw new NonAutorizzato();
  return utente;
}

export async function checkSession(token) {
  const utente = await utenteDaToken(token);
  return utente ? { valid: true, username: utente.username } : { valid: false };
}
