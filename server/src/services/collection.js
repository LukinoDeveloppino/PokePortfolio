// ════════════════════════════════════════════════════════════════════
// collection.js — PORTFOLIO E LISTA DEI DESIDERI
// ════════════════════════════════════════════════════════════════════
// Porting di Script/Portfolio.js e Script/Wishlist.js. Le due liste hanno
// le stesse colonne e vivono nella stessa tabella (collection_items),
// distinte dalla colonna list. Verso il frontend l'id della voce si chiama
// portfolio_id o wishlist_id come nella versione GAS.
// ════════════════════════════════════════════════════════════════════

import { pool } from '../db/pool.js';
import { formatDate } from '../lib/date.js';
import { ErroreApi } from '../lib/errori.js';

export const LISTE = ['portfolio', 'wishlist'];

const CAMPO_ID = { portfolio: 'portfolio_id', wishlist: 'wishlist_id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function controllaLista(lista) {
  if (!LISTE.includes(lista)) throw new Error('Lista sconosciuta: ' + lista);
}

// Id non validi (es. stringhe arbitrarie dal client) farebbero fallire il
// cast a uuid in PostgreSQL: li tratto come "voce non trovata".
function controllaIdVoce(id) {
  if (!UUID.test(String(id || ''))) throw new ErroreApi('Voce non trovata.');
  return String(id);
}

export function convertiVoce(riga, lista) {
  return {
    [CAMPO_ID[lista]]: riga.id,
    card_id:      riga.card_id,
    quantity:     riga.quantity,
    condition:    riga.condition,
    language:     riga.language,
    finish:       riga.finish,
    date_added:   formatDate(riga.added_at),
    blueprint_id: riga.blueprint_id,
    last_price:   riga.last_price
  };
}

export async function leggiVoci(idUtente, lista) {
  controllaLista(lista);
  const { rows } = await pool.query(
    `SELECT id, card_id, quantity, condition, language, finish, added_at, blueprint_id, last_price
       FROM collection_items WHERE user_id = $1 AND list = $2 ORDER BY added_at, id`,
    [idUtente, lista]
  );
  return rows.map((riga) => convertiVoce(riga, lista));
}

export async function getLista(idUtente, lista) {
  return { success: true, items: await leggiVoci(idUtente, lista) };
}

export async function aggiungiVoce(idUtente, lista, { cardId, quantity, condition, language, finish, blueprintId }) {
  controllaLista(lista);
  const quantita = parseInt(quantity, 10);
  if (!cardId || !quantita || !condition || !language || !finish) {
    throw new ErroreApi('Tutti i campi sono obbligatori.');
  }
  if (quantita < 1) throw new ErroreApi('La quantità deve essere almeno 1.');

  const { rows } = await pool.query(
    `INSERT INTO collection_items (user_id, list, card_id, quantity, condition, language, finish, blueprint_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [idUtente, lista, String(cardId), quantita, String(condition), String(language),
     String(finish), blueprintId ? Number(blueprintId) : null]
  );
  return { success: true, [CAMPO_ID[lista]]: rows[0].id };
}

export async function incrementaVoce(idUtente, lista, idVoce, delta) {
  controllaLista(lista);
  const id = controllaIdVoce(idVoce);
  const variazione = parseInt(delta, 10) || 0;

  const { rows } = await pool.query(
    'SELECT quantity FROM collection_items WHERE id = $1 AND user_id = $2 AND list = $3',
    [id, idUtente, lista]
  );
  if (!rows.length) throw new ErroreApi('Voce non trovata.');

  const nuovaQuantita = rows[0].quantity + variazione;
  if (nuovaQuantita <= 0) {
    const nomeFunzione = lista === 'portfolio' ? 'deletePortfolioItem' : 'deleteWishlistItem';
    throw new ErroreApi(`Usa ${nomeFunzione} per rimuovere la voce.`);
  }

  await pool.query('UPDATE collection_items SET quantity = $2 WHERE id = $1', [id, nuovaQuantita]);
  return { success: true, new_quantity: nuovaQuantita };
}

export async function eliminaVoce(idUtente, lista, idVoce) {
  controllaLista(lista);
  const { rowCount } = await pool.query(
    'DELETE FROM collection_items WHERE id = $1 AND user_id = $2 AND list = $3',
    [controllaIdVoce(idVoce), idUtente, lista]
  );
  if (!rowCount) throw new ErroreApi('Voce non trovata.');
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════
// DASHBOARD, EXPORT E STORICI
// ════════════════════════════════════════════════════════════════════

export async function getDashboardData(idUtente) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(ci.quantity), 0)                    AS total_cards,
            count(DISTINCT c.set_id)                         AS total_sets,
            sum(ci.last_price * ci.quantity)                 AS total_value,
            (SELECT prices_updated_at FROM users WHERE id = $1) AS prices_updated_at
       FROM collection_items ci
       LEFT JOIN cards c ON c.id = ci.card_id
      WHERE ci.user_id = $1 AND ci.list = 'portfolio'`,
    [idUtente]
  );
  const riga = rows[0];
  return {
    success:      true,
    total_value:  riga.total_value === null ? null : Math.round(riga.total_value * 100) / 100,
    last_updated: riga.prices_updated_at ? formatDate(riga.prices_updated_at) : null,
    total_cards:  riga.total_cards,
    total_sets:   riga.total_sets
  };
}

export async function exportPortfolioData(idUtente) {
  const { rows } = await pool.query(
    `SELECT ci.*, c.name AS card_name, s.name AS set_name, c.number
       FROM collection_items ci
       LEFT JOIN cards c ON c.id = ci.card_id
       LEFT JOIN sets s  ON s.id = c.set_id
      WHERE ci.user_id = $1 AND ci.list = 'portfolio'
      ORDER BY ci.added_at, ci.id`,
    [idUtente]
  );
  return {
    success: true,
    rows: rows.map((r) => ({
      nome_carta:    r.card_name || r.card_id,
      set:           r.set_name || '',
      numero:        r.number || '',
      condizione:    r.condition,
      lingua:        r.language,
      finitura:      r.finish,
      quantita:      r.quantity,
      data_aggiunta: formatDate(r.added_at),
      last_price:    r.last_price !== null ? r.last_price : ''
    }))
  };
}

// Storico del valore totale del portfolio (grafico della dashboard).
export async function getPriceHistory(idUtente) {
  const { rows } = await pool.query(
    'SELECT ts, total_value FROM value_history WHERE user_id = $1 ORDER BY ts', [idUtente]
  );
  return {
    success: true,
    rows: rows.map((r) => ({ timestamp: formatDate(r.ts), value: r.total_value }))
  };
}

// Storico per voce → { id_voce: [{ t, price }] } (sparkline accanto alle carte).
export async function getStoricoVoci(idUtente, lista) {
  controllaLista(lista);
  const { rows } = await pool.query(
    `SELECT h.item_id, h.ts, h.price
       FROM item_price_history h
       JOIN collection_items ci ON ci.id = h.item_id
      WHERE ci.user_id = $1 AND ci.list = $2
      ORDER BY h.ts`,
    [idUtente, lista]
  );
  const storico = {};
  for (const r of rows) {
    (storico[r.item_id] ||= []).push({ t: formatDate(r.ts), price: r.price });
  }
  return { success: true, history: storico };
}
