// ════════════════════════════════════════════════════════════════════
// auth.js — REGISTRAZIONE, LOGIN E SESSIONI
// ════════════════════════════════════════════════════════════════════
// Porting di Script/Auth.js. Differenze rispetto alla versione GAS:
//   • le sessioni sono righe della tabella sessions, una per login: più
//     utenti (e più dispositivi) restano collegati insieme. In GAS erano
//     nelle UserProperties del proprietario, quindi ne esisteva una sola;
//   • le password sono salvate con scrypt e salt casuale. Gli hash SHA-256
//     importati da Sheets vengono convertiti al primo login riuscito.
// ════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from '../db/pool.js';
import { ErroreApi, NonAutorizzato } from '../lib/errori.js';
import { verificaApiKey } from './cardtrader.js';
import { eTokenDiDefault } from './settings.js';

const scryptAsync = promisify(scrypt);

const DURATA_SESSIONE_MS = 24 * 60 * 60 * 1000;
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

export async function register(username, password, cardtraderApiKey) {
  if (!username || !password) throw new ErroreApi('Nome utente e password sono obbligatori.');

  const nome = String(username).trim();
  if (nome.length < LUNGHEZZA_MINIMA_USERNAME) {
    throw new ErroreApi('Il nome utente deve avere almeno 3 caratteri.');
  }
  const apiKey = await controllaApiKeyNuovoUtente(cardtraderApiKey);

  try {
    await pool.query(
      `INSERT INTO users (username, password_hash, hash_algo, cardtrader_api_key)
       VALUES ($1, $2, 'scrypt', $3)`,
      [nome, await calcolaHashPassword(String(password)), apiKey]
    );
  } catch (errore) {
    if (errore.code === VIOLAZIONE_UNICITA) throw new ErroreApi('Nome utente già in uso.');
    throw errore;
  }
  return { success: true };
}


// La key personale è obbligatoria: i prezzi di ogni utente si chiedono a
// CardTrader con la sua key, così i limiti di una key non ricadono sugli
// altri. La key di default del proprietario serve al catalogo: la può
// usare solo il primo utente, cioè chi ha installato l'app (così basta un
// solo account CardTrader); per tutti gli altri è rifiutata. L'account si
// crea solo con una key che CardTrader ha confermato.
async function esisteAlmenoUnUtente() {
  const { rows } = await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS esiste');
  return rows[0].esiste;
}

async function controllaApiKeyNuovoUtente(cardtraderApiKey) {
  const apiKey = String(cardtraderApiKey || '').trim();
  if (!apiKey) {
    throw new ErroreApi('L\'API key CardTrader è obbligatoria. La trovi su cardtrader.com, ' +
                        'nelle impostazioni del profilo, sezione API.');
  }
  if (await eTokenDiDefault(apiKey) && await esisteAlmenoUnUtente()) {
    throw new ErroreApi('Questa API key non si può usare: inserisci quella del tuo account CardTrader.');
  }

  const esito = await verificaApiKey(apiKey);
  if (esito === 'non_valida') {
    throw new ErroreApi('CardTrader ha rifiutato questa API key: controlla di averla copiata per intero ' +
                        '(cardtrader.com → impostazioni del profilo → sezione API).');
  }
  if (esito !== 'valida') {
    throw new ErroreApi('Non riesco a contattare CardTrader per verificare l\'API key. Riprova tra qualche minuto.');
  }
  return apiKey;
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
    `SELECT u.id, u.username, u.cardtrader_api_key
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
