import { mock } from 'node:test';
import { pool } from '../src/db/pool.js';
import { applicaMigrazioni } from '../src/db/migrate.js';

const logMuto = { info() {}, warn() {}, error() {} };

export async function preparaDatabase() {
  await applicaMigrazioni(logMuto);
  await pool.query(`TRUNCATE users, sessions, settings, job_runs, sets, cards, hidden_sets,
                    collection_items, item_price_history, value_history,
                    tcg_sets, tcg_cards, tcg_collection, tcg_card_vectors, decks, deck_cards
                    RESTART IDENTITY CASCADE`);
}

// Chiama una funzione RPC come farebbe gas-shim.js.
export async function rpc(app, funzione, ...argomenti) {
  const risposta = await app.inject({ method: 'POST', url: `/api/rpc/${funzione}`, payload: argomenti });
  if (risposta.statusCode !== 200) throw new Error(`${funzione}: HTTP ${risposta.statusCode} ${risposta.body}`);
  return risposta.json();
}

// Registra e collega un utente con una key che /info simulato accetta
// (vedi rispostaInfoCardTrader). Il finto fetch vale solo per la
// registrazione: dopo torna quello di prima.
export async function nuovoUtente(app, username, password = 'password123') {
  const finto = simulaFetch((url, opzioni) => rispostaInfoCardTrader(url, opzioni) ?? { status: 404, body: {} });
  let registrazione;
  try {
    registrazione = await rpc(app, 'register', username, password, keyValida(username));
  } finally {
    finto.mock.restore();
  }
  if (!registrazione.success) throw new Error(registrazione.error);
  const accesso = await rpc(app, 'login', username, password);
  return accesso.token;
}

export const keyValida = (username) => `key-valida-${username}`;

// GET /info di CardTrader: 200 per le key "key-valida-…", 401 per le
// altre. undefined se la richiesta non è a /info.
export function rispostaInfoCardTrader(url, opzioni) {
  if (!url.endsWith('/info')) return undefined;
  const autorizzazione = opzioni?.headers?.Authorization || '';
  return autorizzazione.startsWith('Bearer key-valida-')
    ? { id: 1, name: 'PokéPortfolio test' }
    : { status: 401, body: { error: 'Unauthorized' } };
}

// Header Authorization di ogni chiamata fatta al finto fetch che
// contiene `parte` nell'URL.
export function autorizzazioniChiamate(finto, parte) {
  return finto.mock.calls
    .filter((c) => String(c.arguments[0]).includes(parte))
    .map((c) => c.arguments[1]?.headers?.Authorization);
}

// Sostituisce fetch globale: `gestore(url, opzioni)` restituisce il corpo
// JSON da rispondere (o un oggetto { status }) per ogni richiesta.
export function simulaFetch(gestore) {
  return mock.method(globalThis, 'fetch', async (url, opzioni) => {
    const esito = await gestore(String(url), opzioni);
    const status = esito?.status ?? 200;
    return new Response(JSON.stringify(esito?.body ?? esito), {
      status, headers: { 'Content-Type': 'application/json' }
    });
  });
}

export { logMuto };
