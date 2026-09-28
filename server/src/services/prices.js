// ════════════════════════════════════════════════════════════════════
// prices.js — PREZZI DA CARDTRADER E BATCH NOTTURNO
// ════════════════════════════════════════════════════════════════════
// Porting di Script/Prices.js:
//   1. prezzo minimo sul marketplace per una variante (carta, condizione,
//      lingua, finitura);
//   2. richiesta in tempo reale dal frontend (apertura della scheda carta);
//   3. batch che aggiorna i prezzi di tutti gli utenti e scrive gli storici.
// Il batch non lavora più a turni: gira dall'inizio alla fine.
// ════════════════════════════════════════════════════════════════════

import { pool, transazione } from '../db/pool.js';
import { chiamaCardTrader, attendi } from './cardtrader.js';
import { apiKeyPerUtente } from './settings.js';
import { iniziaJob, terminaJob, aggiornaContatoreJob } from './jobs.js';
import { controllaLista } from './collection.js';

// Pausa fra una richiesta e l'altra nel batch (come Utilities.sleep(300)).
const PAUSA_FRA_PREZZI_MS = 300;


// ════════════════════════════════════════════════════════════════════
// CONVERSIONI: valori dell'app → codici CardTrader
// ════════════════════════════════════════════════════════════════════

const CONDIZIONI_CARDTRADER = {
  'Near Mint':         'Near Mint',
  'Lightly Played':    'Slightly Played',
  'Moderately Played': 'Moderately Played',
  'Heavily Played':    'Heavily Played',
  'Damaged':           'Poor'
};

const LINGUE_CARDTRADER = {
  ITA: 'it', ENG: 'en', JPN: 'jp', DEU: 'de', FRA: 'fr', ESP: 'es', KOR: 'kr', POR: 'pt'
};


// ════════════════════════════════════════════════════════════════════
// PREZZO MINIMO DI UNA VARIANTE
// ════════════════════════════════════════════════════════════════════

// { success, price, currency?, message }. price = null quando non ci sono
// offerte; success = false quando CardTrader non risponde.
export async function prezzoVariante({ condition, language, finish, blueprintId }, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };
  if (!blueprintId) return { success: true, price: null, message: 'Prezzo non disponibile' };

  let percorso = `/marketplace/products?blueprint_id=${Number(blueprintId)}` +
                 `&language=${LINGUE_CARDTRADER[language] || 'en'}`;
  if (finish === 'Holofoil' || finish === 'Special') percorso += '&foil=true';

  let risposta;
  try {
    risposta = await chiamaCardTrader(percorso, apiKey);
  } catch {
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }

  return { success: true, ...prezzoMinimo(risposta[String(blueprintId)] || [], condition) };
}

// Parte pura: offerta più economica nella condizione richiesta, oppure in
// qualsiasi condizione se nessuna corrisponde. Prezzi in centesimi.
export function prezzoMinimo(prodotti, condizione) {
  const condizioneCardTrader = CONDIZIONI_CARDTRADER[condizione] || condizione;
  const disponibili = prodotti.filter((p) => !p.on_vacation);

  let candidati = disponibili.filter((p) =>
    !p.properties_hash?.condition || p.properties_hash.condition === condizioneCardTrader);
  if (candidati.length === 0) candidati = disponibili;

  let migliore = null;
  for (const p of candidati) {
    if (typeof p.price?.cents !== 'number') continue;
    if (!migliore || p.price.cents < migliore.cents) migliore = p.price;
  }

  if (!migliore) return { price: null, message: 'Prezzo non disponibile' };
  return {
    price:    Math.round(migliore.cents) / 100,
    currency: migliore.currency || 'EUR',
    message:  null
  };
}


// ════════════════════════════════════════════════════════════════════
// RICHIESTA IN TEMPO REALE (scheda carta)
// ════════════════════════════════════════════════════════════════════

export async function getPrezzoPerVariante(utente, lista, { cardId, condition, language, finish, blueprintId }) {
  controllaLista(lista);

  let idBlueprint = blueprintId ? Number(blueprintId) : null;
  if (!idBlueprint) {
    const { rows } = await pool.query('SELECT blueprint_id FROM cards WHERE id = $1', [String(cardId)]);
    idBlueprint = rows[0]?.blueprint_id || null;
  }

  const risultato = await prezzoVariante(
    { condition, language, finish, blueprintId: idBlueprint }, await apiKeyPerUtente(utente)
  );

  if (risultato.success) {
    // Aggiorno last_price di tutte le voci con la stessa variante.
    await pool.query(
      `UPDATE collection_items SET last_price = $7
        WHERE user_id = $1 AND list = $2 AND card_id = $3
          AND condition = $4 AND language = $5 AND finish = $6`,
      [utente.id, lista, String(cardId), String(condition), String(language), String(finish), risultato.price]
    );
    if (lista === 'portfolio') {
      await pool.query('UPDATE users SET prices_updated_at = now() WHERE id = $1', [utente.id]);
    }
  }
  return risultato;
}


// ════════════════════════════════════════════════════════════════════
// BATCH: PREZZI DI TUTTI GLI UTENTI
// ════════════════════════════════════════════════════════════════════

// Stessa interfaccia di avviaSyncCatalogo: { avviato, completata }.
export async function avviaAggiornamentoPrezzi({ log = console } = {}) {
  const idEsecuzione = await iniziaJob('prices');
  if (!idEsecuzione) return { avviato: false };

  const completata = eseguiBatchPrezzi(idEsecuzione, log)
    .then(async (contatore) => {
      await terminaJob(idEsecuzione, { contatore });
      log.info(`[PREZZI] Completato: ${contatore} voci aggiornate.`);
      return contatore;
    })
    .catch(async (errore) => {
      log.error(`[PREZZI] Errore: ${errore.message}`);
      await terminaJob(idEsecuzione, { errore: errore.message }).catch(() => {});
      throw errore;
    });

  completata.catch(() => {});
  return { avviato: true, completata };
}

async function eseguiBatchPrezzi(idEsecuzione, log) {
  const { rows: utenti } = await pool.query('SELECT id, username, cardtrader_api_key FROM users ORDER BY id');
  let vociAggiornate = 0;

  for (const utente of utenti) {
    const apiKey = await apiKeyPerUtente(utente);
    if (!apiKey) {
      log.warn(`[PREZZI] ${utente.username}: nessuna API key, lo salto.`);
      continue;
    }

    const { rows: voci } = await pool.query(
      `SELECT ci.id, ci.list, ci.quantity, ci.condition, ci.language, ci.finish, ci.last_price,
              COALESCE(ci.blueprint_id, c.blueprint_id) AS blueprint_id
         FROM collection_items ci LEFT JOIN cards c ON c.id = ci.card_id
        WHERE ci.user_id = $1
        ORDER BY ci.list, ci.added_at`,
      [utente.id]
    );

    // Prezzo aggiornato di ogni voce; se CardTrader non ne dà uno nuovo
    // resta l'ultimo noto, come nella versione GAS.
    const prezzi = new Map();
    for (const voce of voci) {
      let prezzo = voce.last_price;
      try {
        const risultato = await prezzoVariante(
          { condition: voce.condition, language: voce.language, finish: voce.finish, blueprintId: voce.blueprint_id },
          apiKey
        );
        if (risultato.success && risultato.price !== null) prezzo = risultato.price;
      } catch (errore) {
        log.warn(`[PREZZI] ${utente.username} voce ${voce.id}: ${errore.message}`);
      }
      prezzi.set(voce.id, prezzo);
      await attendi(PAUSA_FRA_PREZZI_MS);
    }

    await salvaPrezziUtente(utente.id, voci, prezzi);
    vociAggiornate += voci.length;
    await aggiornaContatoreJob(idEsecuzione, vociAggiornate);
    log.info(`[PREZZI] ${utente.username}: ${voci.length} voci`);
  }
  return vociAggiornate;
}

// Scrive in una transazione last_price, storico per voce, valore totale
// del portfolio e data di aggiornamento. Stesso timestamp per tutto il giro
// dell'utente, così i punti degli storici si allineano.
async function salvaPrezziUtente(idUtente, voci, prezzi) {
  const conPrezzo = voci.filter((v) => prezzi.get(v.id) !== null && prezzi.get(v.id) !== undefined);
  const valoreTotale = conPrezzo
    .filter((v) => v.list === 'portfolio')
    .reduce((totale, v) => totale + prezzi.get(v.id) * v.quantity, 0);

  await transazione(async (tx) => {
    const { rows } = await tx.query('SELECT now() AS adesso');
    const adesso = rows[0].adesso;

    if (conPrezzo.length) {
      const id = conPrezzo.map((v) => v.id);
      const prezzo = conPrezzo.map((v) => prezzi.get(v.id));
      await tx.query(
        `UPDATE collection_items ci SET last_price = n.prezzo
           FROM unnest($1::uuid[], $2::numeric[]) AS n(id, prezzo) WHERE ci.id = n.id`,
        [id, prezzo]
      );
      await tx.query(
        `INSERT INTO item_price_history (item_id, ts, price)
         SELECT n.id, $3, n.prezzo FROM unnest($1::uuid[], $2::numeric[]) AS n(id, prezzo)
         ON CONFLICT DO NOTHING`,
        [id, prezzo, adesso]
      );
    }

    // Come in GAS: il totale si registra solo per chi ha un portfolio.
    if (voci.some((v) => v.list === 'portfolio')) {
      await tx.query(
        'INSERT INTO value_history (user_id, ts, total_value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [idUtente, adesso, Math.round(valoreTotale * 100) / 100]
      );
    }
    await tx.query('UPDATE users SET prices_updated_at = $2 WHERE id = $1', [idUtente, adesso]);
  });
}
