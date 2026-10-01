// ════════════════════════════════════════════════════════════════════
// settings.js — PARAMETRI GLOBALI (tabella settings, ex BATCH_STATE)
// ════════════════════════════════════════════════════════════════════

import { pool } from '../db/pool.js';
import { config } from '../config.js';

export async function leggiParametro(chiave) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [chiave]);
  return rows.length ? rows[0].value : null;
}

export async function scriviParametro(chiave, valore) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [chiave, valore]
  );
}

// API key CardTrader del proprietario. Serve SOLO alle operazioni
// condivise (sync del catalogo e refresh dei set, vedi catalog.js): i
// prezzi di ogni utente usano la sua key personale. Prima quella
// dell'ambiente, altrimenti quella importata dal vecchio BATCH_STATE
// (riga default_token).
export async function tokenCardTraderDiDefault() {
  return config.cardTraderDefaultToken || (await leggiParametro('default_token')) || '';
}

// true se la key coincide con una delle key di default del proprietario
// (quella dell'ambiente o quella in settings).
export async function eTokenDiDefault(apiKey) {
  if (!apiKey) return false;
  const candidati = [config.cardTraderDefaultToken, await leggiParametro('default_token')];
  return candidati.some((token) => token && token.trim() === apiKey);
}

// API key da usare per i prezzi di un utente: solo la sua. Stringa vuota
// se non ne ha una: in quel caso non si chiama CardTrader.
export function apiKeyPerUtente(utente) {
  return (utente && utente.cardtrader_api_key) || '';
}

// Utenti senza key (importati da Sheets, dove avevano una copia della key
// di default): ricevono CARDTRADER_DEFAULT_TOKEN. Gira a ogni avvio dopo
// le migrazioni; se non c'è nessuno da sistemare non cambia niente.
// Restituisce il numero di utenti aggiornati.
export async function assegnaKeyDiDefaultAgliUtentiSenzaKey() {
  if (!config.cardTraderDefaultToken) return 0;
  const { rowCount } = await pool.query(
    'UPDATE users SET cardtrader_api_key = $1 WHERE cardtrader_api_key IS NULL',
    [config.cardTraderDefaultToken]
  );
  return rowCount;
}
