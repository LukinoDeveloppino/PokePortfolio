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

// Registra e collega un utente.
export async function nuovoUtente(app, username, password = 'password123') {
  const registrazione = await rpc(app, 'register', username, password);
  if (!registrazione.success) throw new Error(registrazione.error);
  const accesso = await rpc(app, 'login', username, password);
  return accesso.token;
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
