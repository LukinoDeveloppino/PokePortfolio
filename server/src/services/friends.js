// ════════════════════════════════════════════════════════════════════
// friends.js — PORTFOLIO DEGLI ALTRI UTENTI (sola lettura)
// ════════════════════════════════════════════════════════════════════
// Il frontend identifica l'amico con il campo sheet_id (in GAS era l'ID
// del suo Google Sheet): ora contiene l'id utente, così script.html non
// cambia.
// ════════════════════════════════════════════════════════════════════

import { pool } from '../db/pool.js';
import { ErroreApi } from '../lib/errori.js';
import { leggiVoci } from './collection.js';
import { getCardsForIds } from './catalog.js';

export async function getFriends(idUtente) {
  const { rows } = await pool.query(
    'SELECT id, username FROM users WHERE id <> $1 ORDER BY lower(username)', [idUtente]
  );
  return { success: true, items: rows.map((r) => ({ username: r.username, sheet_id: String(r.id) })) };
}

export async function getFriendPortfolio(idAmico) {
  const id = Number(idAmico);
  if (!Number.isInteger(id) || id <= 0) throw new ErroreApi('Utente non trovato nel sistema.');

  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
  if (!rowCount) throw new ErroreApi('Utente non trovato nel sistema.');

  const voci = await leggiVoci(id, 'portfolio');
  const { cards } = await getCardsForIds([...new Set(voci.map((v) => v.card_id))]);
  return {
    success: true,
    items:   voci,
    cards:   Object.fromEntries(cards.map((c) => [c.id, c]))
  };
}
