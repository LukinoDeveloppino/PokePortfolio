// ════════════════════════════════════════════════════════════════════
// riconoscimento.js — RICONOSCERE UNA CARTA DA UNA FOTO
// ════════════════════════════════════════════════════════════════════
// Metodo provato in knn/knn_carte.py (estrattore "pixel"):
//   • ogni carta in versione base ha un'impronta: la sua immagine
//     ufficiale ridotta a 16×22 pixel a colori (1056 numeri 0-255);
//   • il browser trova la carta nella foto, la raddrizza, ne calcola
//     l'impronta allo stesso modo (tcg.html) e la manda qui;
//   • qui si cercano le impronte più vicine (similarità coseno) e i
//     vicini votano per la loro carta di gioco (k-nearest neighbors).
// Le impronte si calcolano durante il job tcg_sync, solo per le carte
// che non l'hanno ancora o che hanno cambiato immagine.
// ════════════════════════════════════════════════════════════════════

import { PNG } from 'pngjs';
import { pool } from '../db/pool.js';
import { ErroreApi } from '../lib/errori.js';
import { leggiLettereStandard, cartaLegale } from './tcg.js';

export const LARGHEZZA_IMPRONTA = 16;
export const ALTEZZA_IMPRONTA = 22;
export const LUNGHEZZA_IMPRONTA = LARGHEZZA_IMPRONTA * ALTEZZA_IMPRONTA * 3;

// Le stampe da gioco con la cornice normale: full art, illustration rare,
// hyper rare e promo restano fuori (meno carte simili, meno confusione).
export const RARITA_RICONOSCIUTE = ['Common', 'Uncommon', 'Rare', 'Double Rare', 'ACE SPEC Rare'];

const VICINI = 5;
const CANDIDATI = 5;
// Il browser manda più ritagli della stessa foto, ognuno dritto e capovolto.
const MASSIMO_IMPRONTE = 24;
const DOWNLOAD_IN_PARALLELO = 4;
const TIMEOUT_IMMAGINE_MS = 30_000;


// ════════════════════════════════════════════════════════════════════
// IMPRONTA DI UN'IMMAGINE
// ════════════════════════════════════════════════════════════════════
// Stesso calcolo di impronta() in tcg.html: i pixel trasparenti (gli
// angoli arrotondati delle immagini ufficiali) si appoggiano sul bianco,
// poi ogni cella della griglia 16×22 è la media dei pixel che copre.
// Le celle sono frazionarie: un pixel a cavallo di due celle conta per
// la parte che cade in ciascuna.

export function impronta(rgba, larghezza, altezza) {
  const somme = new Float64Array(LUNGHEZZA_IMPRONTA);
  const pesi = new Float64Array(LARGHEZZA_IMPRONTA * ALTEZZA_IMPRONTA);
  const fx = LARGHEZZA_IMPRONTA / larghezza;
  const fy = ALTEZZA_IMPRONTA / altezza;

  const perColonna = Array.from({ length: larghezza }, (_, x) => celleCoperte(x, fx, LARGHEZZA_IMPRONTA));
  for (let y = 0; y < altezza; y++) {
    const [righe, pesiY] = celleCoperte(y, fy, ALTEZZA_IMPRONTA);
    for (let x = 0; x < larghezza; x++) {
      const [colonne, pesiX] = perColonna[x];
      const i = (y * larghezza + x) * 4;
      const alfa = rgba[i + 3] / 255;
      const r = rgba[i] * alfa + 255 * (1 - alfa);
      const g = rgba[i + 1] * alfa + 255 * (1 - alfa);
      const b = rgba[i + 2] * alfa + 255 * (1 - alfa);
      for (let a = 0; a < righe.length; a++) {
        for (let c = 0; c < colonne.length; c++) {
          const cella = righe[a] * LARGHEZZA_IMPRONTA + colonne[c];
          const peso = pesiY[a] * pesiX[c];
          somme[cella * 3] += r * peso;
          somme[cella * 3 + 1] += g * peso;
          somme[cella * 3 + 2] += b * peso;
          pesi[cella] += peso;
        }
      }
    }
  }
  const risultato = new Uint8Array(LUNGHEZZA_IMPRONTA);
  for (let i = 0; i < risultato.length; i++) risultato[i] = Math.round(somme[i] / pesi[Math.floor(i / 3)]);
  return risultato;
}

// Celle (righe o colonne) coperte dal pixel p e quanto ne copre ciascuna.
function celleCoperte(p, fattore, celle) {
  const inizio = p * fattore;
  const fine = (p + 1) * fattore;
  const indici = [];
  const pesi = [];
  for (let c = Math.floor(inizio); c < Math.min(Math.ceil(fine), celle); c++) {
    const parte = Math.min(fine, c + 1) - Math.max(inizio, c);
    if (parte > 0) { indici.push(c); pesi.push(parte); }
  }
  return [indici, pesi];
}

export function improntaDaPng(dati) {
  const png = PNG.sync.read(Buffer.from(dati));
  return impronta(png.data, png.width, png.height);
}


// ════════════════════════════════════════════════════════════════════
// AGGIORNAMENTO DELLE IMPRONTE (durante tcg_sync)
// ════════════════════════════════════════════════════════════════════

async function scaricaImmagine(url) {
  const risposta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_IMMAGINE_MS) });
  if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
  return new Uint8Array(await risposta.arrayBuffer());
}

// Calcola le impronte mancanti o superate. Una carta che non si scarica
// non ferma le altre: ci si riprova al giro successivo.
export async function aggiornaImpronte({ log = console, alProgresso = () => {} } = {}) {
  const { rows: daFare } = await pool.query(
    `SELECT c.id, c.image_small
       FROM tcg_cards c
       LEFT JOIN tcg_card_vectors v ON v.card_id = c.id
      WHERE c.rarity = ANY($1::text[])
        AND c.supertype IN ('Pokémon', 'Trainer')
        AND c.regulation_mark IS NOT NULL
        AND c.image_small IS NOT NULL
        AND (v.card_id IS NULL OR v.image_url <> c.image_small)`,
    [RARITA_RICONOSCIUTE]
  );
  if (!daFare.length) return 0;
  log.info(`[RICONOSCIMENTO] Impronte da calcolare: ${daFare.length}`);

  let fatte = 0;
  let fallite = 0;
  let prossima = 0;
  async function lavoratore() {
    while (prossima < daFare.length) {
      const carta = daFare[prossima++];
      try {
        const vettore = improntaDaPng(await scaricaImmagine(carta.image_small));
        await pool.query(
          `INSERT INTO tcg_card_vectors (card_id, image_url, vector) VALUES ($1, $2, $3)
           ON CONFLICT (card_id) DO UPDATE SET
             image_url = EXCLUDED.image_url, vector = EXCLUDED.vector, updated_at = now()`,
          [carta.id, carta.image_small, Buffer.from(vettore)]
        );
        fatte++;
        if (fatte % 100 === 0) await alProgresso(fatte, daFare.length);
      } catch (errore) {
        fallite++;
        if (fallite <= 5) log.warn(`[RICONOSCIMENTO] ${carta.id}: ${errore.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_IN_PARALLELO }, lavoratore));

  if (fallite) log.warn(`[RICONOSCIMENTO] Impronte non calcolate: ${fallite} (riprovo al prossimo aggiornamento).`);
  log.info(`[RICONOSCIMENTO] Impronte calcolate: ${fatte}`);
  indice = null;
  return fatte;
}

export async function improntePresenti() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM tcg_card_vectors');
  return rows[0].n;
}


// ════════════════════════════════════════════════════════════════════
// INDICE IN MEMORIA
// ════════════════════════════════════════════════════════════════════
// Poche migliaia di vettori da 1056 numeri: si tengono in memoria,
// normalizzati, e si confrontano tutti a ogni foto (pochi millisecondi).
// Solo le carte legali: l'indice si ricostruisce se cambiano le lettere
// dello Standard o dopo un aggiornamento delle impronte.

let indice = null;   // { lettere, carte: [{ id, game_key }], vettori: Float32Array }

export function svuotaIndice() {
  indice = null;
}

async function leggiIndice() {
  const lettere = await leggiLettereStandard();
  const firma = lettere.join(',');
  if (indice && indice.lettere === firma) return indice;

  const { rows } = await pool.query(
    `SELECT c.id, c.game_key, c.regulation_mark, v.vector
       FROM tcg_card_vectors v
       JOIN tcg_cards c ON c.id = v.card_id AND c.image_small = v.image_url
      WHERE c.rarity = ANY($1::text[])
      ORDER BY c.id`,
    [RARITA_RICONOSCIUTE]
  );
  const legali = rows.filter((r) => cartaLegale(r, lettere));
  const vettori = new Float32Array(legali.length * LUNGHEZZA_IMPRONTA);
  legali.forEach((riga, i) => vettori.set(normalizza(riga.vector), i * LUNGHEZZA_IMPRONTA));
  indice = { lettere: firma, carte: legali.map((r) => ({ id: r.id, game_key: r.game_key })), vettori };
  return indice;
}

function normalizza(valori) {
  let norma = 0;
  for (let i = 0; i < valori.length; i++) norma += valori[i] * valori[i];
  norma = Math.sqrt(norma) || 1;
  const risultato = new Float32Array(valori.length);
  for (let i = 0; i < valori.length; i++) risultato[i] = valori[i] / norma;
  return risultato;
}

// I VICINI carte più simili: [{ posizione, similarita }] in ordine.
function viciniDi(vettore, { carte, vettori }) {
  const migliori = [];
  for (let c = 0; c < carte.length; c++) {
    let prodotto = 0;
    const base = c * LUNGHEZZA_IMPRONTA;
    for (let i = 0; i < LUNGHEZZA_IMPRONTA; i++) prodotto += vettore[i] * vettori[base + i];
    if (migliori.length < VICINI || prodotto > migliori[migliori.length - 1].similarita) {
      migliori.push({ posizione: c, similarita: prodotto });
      migliori.sort((a, b) => b.similarita - a.similarita);
      if (migliori.length > VICINI) migliori.pop();
    }
  }
  return migliori;
}


// ════════════════════════════════════════════════════════════════════
// RICONOSCIMENTO (RPC recognizeTcgCard)
// ════════════════════════════════════════════════════════════════════

function leggiImpronta(valori) {
  if (!Array.isArray(valori) || valori.length !== LUNGHEZZA_IMPRONTA ||
      !valori.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new ErroreApi('Impronta della foto non valida.');
  }
  return normalizza(valori);
}

// `impronte`: una o più impronte della stessa foto, cioè ritagli diversi,
// ognuno dritto e capovolto (il ritaglio non sa da che parte sta la
// carta). Vince l'impronta con il vicino più simile; best_index dice
// quale. Restituisce le carte di gioco candidate, la più probabile per prima.
export async function riconosciCarta(idUtente, impronte) {
  const elenco = Array.isArray(impronte) && Array.isArray(impronte[0]) ? impronte : [impronte];
  if (!elenco.length || elenco.length > MASSIMO_IMPRONTE) throw new ErroreApi('Impronta della foto non valida.');
  const vettori = elenco.map(leggiImpronta);

  const corrente = await leggiIndice();
  if (!corrente.carte.length) {
    throw new ErroreApi('Il riconoscimento non è ancora pronto: le immagini delle carte vanno ancora elaborate. ' +
                        'Riprova dopo il prossimo aggiornamento delle carte.');
  }

  const perImpronta = vettori.map((v) => viciniDi(v, corrente));
  let migliore = 0;
  perImpronta.forEach((v, i) => { if (v[0].similarita > perImpronta[migliore][0].similarita) migliore = i; });
  const vicini = perImpronta[migliore];

  // Voto pesato: più un vicino è simile, più conta (come in knn_carte.py).
  const voti = new Map();
  for (const { posizione, similarita } of vicini) {
    const carta = corrente.carte[posizione];
    const peso = 1 / (1 - similarita + 1e-6);
    const voce = voti.get(carta.game_key) || { peso: 0, card_id: carta.id, similarita };
    voce.peso += peso;
    voti.set(carta.game_key, voce);
  }
  const totale = [...voti.values()].reduce((s, v) => s + v.peso, 0);
  const classifica = [...voti.entries()]
    .sort((a, b) => b[1].peso - a[1].peso)
    .slice(0, CANDIDATI);

  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.number, c.supertype, c.subtypes, c.game_key, c.rarity,
            c.image_small, c.image_large, s.code AS set_code
       FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id
      WHERE c.id = ANY($1::text[])`,
    [classifica.map(([, v]) => v.card_id)]
  );
  const { rows: possedute } = await pool.query(
    'SELECT game_key, quantity FROM tcg_collection WHERE user_id = $1 AND game_key = ANY($2::text[])',
    [idUtente, classifica.map(([chiave]) => chiave)]
  );
  const perId = new Map(rows.map((r) => [r.id, r]));
  const copie = new Map(possedute.map((r) => [r.game_key, r.quantity]));

  return {
    success: true,
    // Similarità del vicino più vicino (0-1): sotto ~0,98 la foto
    // probabilmente non è venuta bene o la carta non è fra quelle note.
    best_similarity: Math.round(vicini[0].similarita * 1000) / 1000,
    // Quale delle impronte ricevute ha vinto (per mostrare quel ritaglio).
    best_index: migliore,
    candidates: classifica.map(([chiave, voto]) => {
      const carta = perId.get(voto.card_id) || {};
      return {
        game_key:    chiave,
        card_id:     voto.card_id,
        name:        carta.name || '',
        supertype:   carta.supertype || '',
        subtypes:    carta.subtypes || [],
        set_code:    carta.set_code || '',
        number:      carta.number || '',
        image_small: carta.image_small || '',
        image_large: carta.image_large || '',
        score:       Math.round((voto.peso / totale) * 1000) / 1000,
        similarity:  Math.round(voto.similarita * 1000) / 1000,
        owned:       copie.get(chiave) || 0
      };
    })
  };
}
