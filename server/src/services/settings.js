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

// API key CardTrader del proprietario: l'unica usata dal server, per il
// catalogo e per i prezzi di tutti gli utenti. Prima quella
// dell'ambiente, altrimenti quella importata dal vecchio BATCH_STATE
// (riga default_token).
export async function tokenCardTraderDiDefault() {
  return config.cardTraderDefaultToken || (await leggiParametro('default_token')) || '';
}
