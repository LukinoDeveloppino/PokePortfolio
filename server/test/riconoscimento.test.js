// Riconoscimento delle carte da foto: impronta delle immagini, calcolo
// delle impronte (immagini simulate sostituendo fetch) e RPC
// recognizeTcgCard su un database vero (vedi setup.js).

import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import {
  impronta, improntaDaPng, aggiornaImpronte, svuotaIndice, LUNGHEZZA_IMPRONTA
} from '../src/services/riconoscimento.js';
import { preparaDatabase, rpc, nuovoUtente, logMuto } from './helpers.js';

const app = buildApp({ logger: false });

before(() => app.ready());
after(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await preparaDatabase();
  svuotaIndice();
});
afterEach(() => mock.restoreAll());


// ---- Immagini di prova ----

// RGBA di un'immagine larghezza × altezza; colore(x, y) → [r, g, b, a].
function immagine(larghezza, altezza, colore) {
  const dati = new Uint8Array(larghezza * altezza * 4);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) dati.set(colore(x, y), (y * larghezza + x) * 4);
  }
  return dati;
}

function png(larghezza, altezza, colore) {
  const file = new PNG({ width: larghezza, height: altezza });
  file.data = Buffer.from(immagine(larghezza, altezza, colore));
  return PNG.sync.write(file);
}

// Impronta di una carta "a strisce": ogni carta di prova ha un suo disegno.
const disegno = (n) => (x, y) => [(x * 37 + n * 91) % 256, (y * 53 + n * 17) % 256, (n * 67) % 256, 255];
const improntaCarta = (n) => [...impronta(immagine(32, 44, disegno(n)), 32, 44)];
const capovolta = (valori) => {
  const risultato = [];
  for (let cella = valori.length / 3 - 1; cella >= 0; cella--) risultato.push(...valori.slice(cella * 3, cella * 3 + 3));
  return risultato;
};


// ════════════════════════════════════════════════════════════════════
// IMPRONTA
// ════════════════════════════════════════════════════════════════════

test('impronta: 16×22 celle RGB, media dei pixel di ogni cella', () => {
  const rossa = impronta(immagine(245, 342, () => [255, 0, 0, 255]), 245, 342);
  assert.equal(rossa.length, LUNGHEZZA_IMPRONTA);
  assert.deepEqual([...rossa.slice(0, 6)], [255, 0, 0, 255, 0, 0]);

  // Metà sinistra nera, metà destra bianca: le colonne 0-7 nere, 8-15 bianche.
  const meta = impronta(immagine(32, 44, (x) => (x < 16 ? [0, 0, 0, 255] : [255, 255, 255, 255])), 32, 44);
  assert.deepEqual([...meta.slice(7 * 3, 7 * 3 + 3)], [0, 0, 0]);
  assert.deepEqual([...meta.slice(8 * 3, 8 * 3 + 3)], [255, 255, 255]);
});

test('impronta: i pixel trasparenti contano come bianco', () => {
  const trasparente = impronta(immagine(32, 44, () => [0, 0, 0, 0]), 32, 44);
  assert.ok(trasparente.every((v) => v === 255));
});

test('impronta: celle frazionarie quando le dimensioni non sono multiple', () => {
  // 24 colonne → 16 celle: ogni cella copre 1,5 pixel. Colonne alternate
  // nere e bianche: nessuna cella resta pura.
  const valori = impronta(immagine(24, 33, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 24, 33);
  assert.ok(valori.every((v) => v > 0 && v < 255));
});

test('improntaDaPng legge un PNG vero', () => {
  const valori = improntaDaPng(png(32, 44, () => [10, 20, 30, 255]));
  assert.deepEqual([...valori.slice(0, 3)], [10, 20, 30]);
});


// ════════════════════════════════════════════════════════════════════
// CARTE DI PROVA
// ════════════════════════════════════════════════════════════════════

async function catalogo() {
  await pool.query(`INSERT INTO tcg_sets (id, name, code, release_date) VALUES
                    ('sv6', 'Twilight Masquerade', 'TWM', '2024-05-24'),
                    ('sv1', 'Scarlet & Violet', 'SVI', '2023-03-31')`);
  const carte = [
    // id, numero, nome, tipo, simbolo, chiave, rarità
    ['sv6-128', '128', 'Dreepy', 'Pokémon', 'H', 'P|dreepy|a', 'Common'],
    ['sv6-130', '130', 'Dragapult ex', 'Pokémon', 'H', 'P|dragapult ex|b', 'Double Rare'],
    ['sv6-200', '200', 'Dragapult ex', 'Pokémon', 'H', 'P|dragapult ex|b', 'Special Illustration Rare'],
    ['sv6-163', '163', 'Rare Candy', 'Trainer', 'H', 'T|rare candy', 'Uncommon'],
    // Ruotata: con le lettere predefinite (H, I, J) non è legale.
    ['sv1-001', '1', 'Pineco', 'Pokémon', 'G', 'P|pineco|c', 'Common']
  ];
  for (const [id, numero, nome, tipo, simbolo, chiave, rarita] of carte) {
    await pool.query(
      `INSERT INTO tcg_cards (id, set_id, number, name, supertype, regulation_mark, game_key, rarity, image_small)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, id.split('-')[0], numero, nome, tipo, simbolo, chiave, rarita, `https://img/${id}.png`]
    );
  }
}

// Le impronte come le calcolerebbe il job: la carta n ha il disegno n.
const NUMERO_CARTA = { 'sv6-128': 1, 'sv6-130': 2, 'sv6-200': 3, 'sv6-163': 4, 'sv1-001': 5 };

function simulaImmagini() {
  return mock.method(globalThis, 'fetch', async (url) => {
    const id = String(url).match(/img\/(.+)\.png$/)?.[1];
    if (!(id in NUMERO_CARTA)) return new Response('', { status: 404 });
    return new Response(png(32, 44, disegno(NUMERO_CARTA[id])), { headers: { 'Content-Type': 'image/png' } });
  });
}


// ════════════════════════════════════════════════════════════════════
// AGGIORNAMENTO DELLE IMPRONTE
// ════════════════════════════════════════════════════════════════════

test('aggiornaImpronte: solo versioni base, una volta sola', async () => {
  await catalogo();
  const finto = simulaImmagini();

  assert.equal(await aggiornaImpronte({ log: logMuto }), 4);   // non la Special Illustration Rare
  const { rows } = await pool.query('SELECT card_id FROM tcg_card_vectors ORDER BY card_id');
  assert.deepEqual(rows.map((r) => r.card_id), ['sv1-001', 'sv6-128', 'sv6-130', 'sv6-163']);

  // Al giro dopo non riscarica niente...
  assert.equal(await aggiornaImpronte({ log: logMuto }), 0);
  assert.equal(finto.mock.callCount(), 4);

  // ...a meno che l'immagine non cambi.
  await pool.query(`UPDATE tcg_cards SET image_small = 'https://img/sv6-163.png?v=2' WHERE id = 'sv6-163'`);
  finto.mock.mockImplementation(async () => new Response(png(32, 44, disegno(4))));
  assert.equal(await aggiornaImpronte({ log: logMuto }), 1);
});

test('aggiornaImpronte: un\'immagine che non si scarica non ferma le altre', async () => {
  await catalogo();
  simulaImmagini();
  await pool.query(`UPDATE tcg_cards SET image_small = 'https://img/manca.png' WHERE id = 'sv6-128'`);
  assert.equal(await aggiornaImpronte({ log: logMuto }), 3);
});


// ════════════════════════════════════════════════════════════════════
// RPC recognizeTcgCard
// ════════════════════════════════════════════════════════════════════

test('recognizeTcgCard: prima di calcolare le impronte non è pronto', async () => {
  const token = await nuovoUtente(app, 'mario');
  await catalogo();
  const res = await rpc(app, 'recognizeTcgCard', token, [improntaCarta(2)]);
  assert.equal(res.success, false);
  assert.match(res.error, /non è ancora pronto/);
});

test('recognizeTcgCard: trova la carta, anche capovolta, e dice quante se ne hanno', async () => {
  const token = await nuovoUtente(app, 'mario');
  await catalogo();
  simulaImmagini();
  await aggiornaImpronte({ log: logMuto });
  await rpc(app, 'addTcgCopies', token, 'P|dragapult ex|b', 2);

  const dritta = improntaCarta(2);
  const res = await rpc(app, 'recognizeTcgCard', token, [dritta, capovolta(dritta)]);
  assert.equal(res.success, true);
  assert.equal(res.best_similarity, 1);
  const [prima] = res.candidates;
  assert.equal(prima.game_key, 'P|dragapult ex|b');
  assert.equal(prima.card_id, 'sv6-130');
  assert.equal(prima.set_code, 'TWM');
  assert.equal(prima.number, '130');
  assert.equal(prima.owned, 2);

  // La foto arriva capovolta: il verso giusto è il secondo.
  const alContrario = await rpc(app, 'recognizeTcgCard', token, [capovolta(dritta), dritta]);
  assert.equal(alContrario.candidates[0].game_key, 'P|dragapult ex|b');

  assert.equal(res.best_index, 0);
  assert.equal(alContrario.best_index, 1);

  // Più ritagli della stessa foto: vince quello che somiglia a una carta.
  const sporca = dritta.map((v, i) => (i % 7 ? v : 255 - v));
  const ritagli = await rpc(app, 'recognizeTcgCard', token, [sporca, capovolta(sporca), dritta, capovolta(dritta)]);
  assert.equal(ritagli.best_index, 2);
  assert.equal(ritagli.candidates[0].game_key, 'P|dragapult ex|b');

  // Una sola impronta va bene lo stesso.
  const sola = await rpc(app, 'recognizeTcgCard', token, improntaCarta(4));
  assert.equal(sola.candidates[0].game_key, 'T|rare candy');
});

test('recognizeTcgCard: le carte non legali non escono mai', async () => {
  const token = await nuovoUtente(app, 'mario');
  await catalogo();
  simulaImmagini();
  await aggiornaImpronte({ log: logMuto });

  const res = await rpc(app, 'recognizeTcgCard', token, [improntaCarta(5)]);
  assert.equal(res.success, true);
  assert.ok(res.candidates.every((c) => c.game_key !== 'P|pineco|c'));
  assert.ok(res.best_similarity < 1);
});

test('recognizeTcgCard: impronte non valide', async () => {
  const token = await nuovoUtente(app, 'mario');
  const troppe = Array.from({ length: 25 }, () => Array(LUNGHEZZA_IMPRONTA).fill(0));
  for (const impronte of [null, [], [[1, 2, 3]], [Array(LUNGHEZZA_IMPRONTA).fill(300)], [1, 2, 3], troppe]) {
    const res = await rpc(app, 'recognizeTcgCard', token, impronte);
    assert.equal(res.success, false);
    assert.match(res.error, /non valida/);
  }
});
