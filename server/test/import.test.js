// Import dagli .xlsx di Google Sheets: file costruiti con la stessa
// struttura (e le stesse stranezze) degli export reali.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { leggiMaster, leggiFileUtente, importa } from '../src/import/sheets.js';
import { preparaDatabase, rpc } from './helpers.js';

const app = buildApp({ logger: false });
let cartella;

const sha = (testo) => createHash('sha256').update(testo, 'utf8').digest('hex');
// Come le esporta Sheets: orario da orologio nei campi UTC, senza fuso.
const dataSheets = (testo) => new Date(testo.replace(' ', 'T') + 'Z');

const ID_CHARIZARD = '0b6f7e2c-6a55-4b8e-9d3b-2f1f1c9a7e01';
const ID_PIKACHU   = '1c7a8f3d-7b66-4c9f-8e4c-3a2a2dab8f02';
const ID_ELIMINATO = '2d8b9a4e-8c77-4da0-9f5d-4b3b3ebc9a03';
const ID_DESIDERIO = '3e9cab5f-9d88-4eb1-a06e-5c4c4fcdab04';

async function scrivi(nome, fogli) {
  const cartellaExcel = new ExcelJS.Workbook();
  for (const [nomeFoglio, righe] of Object.entries(fogli)) cartellaExcel.addWorksheet(nomeFoglio).addRows(righe);
  const percorso = path.join(cartella, nome);
  await cartellaExcel.xlsx.writeFile(percorso);
  return percorso;
}

before(async () => {
  await app.ready();
  cartella = await mkdtemp(path.join(tmpdir(), 'pokeportfolio-import-'));
});
after(async () => {
  await rm(cartella, { recursive: true, force: true });
  await app.close();
  await pool.end();
});
beforeEach(preparaDatabase);

async function fileDiProva() {
  const master = await scrivi('PokePortfolio - Master.xlsx', {
    UTENTI: [
      ['ash', sha('pikachu1'), 'sheet-ash', 'key-personale-ash'],
      ['Misty', sha('staryu12'), 'sheet-misty', 'token-default'],
      ['', '', '', '']
    ],
    SET_CACHE: [
      ['set_id', 'set_name', 'set_series', 'set_logo_url', 'release_date', 'total_cards', 'ct_expansion_id'],
      [10, 'Base Set', 'INT', 'https://logo/base.png', dataSheets('1999-01-09 00:00:00'), 2, 10],
      [20, 'Pokémon Card 151', 'JP', '', '', 1, 20]
    ],
    CACHE_CARDS: [
      ['id', 'name', 'set_id', 'set_name', 'set_series', 'number', 'rarity', 'types',
       'image_url_small', 'image_url_large', 'set_logo_url', 'last_updated', 'blueprint_id'],
      ['10_1', 'Charizard', 10, 'Base Set', 'INT', 4, 'Rare Holo', '', 'https://img/1.jpg', 'https://img/1.jpg', '', '', 1],
      // "012" diventato 12, come fa Sheets.
      ['10_2', 'Pikachu', 10, 'Base Set', 'INT', 12, 'Common', '', 'https://img/2.jpg', 'https://img/2.jpg', '', '', 2],
      ['20_3', 'Mew', 20, 'Pokémon Card 151', 'JP', '151', 'AR', '', 'https://img/3.jpg', 'https://img/3.jpg', '', '', 3]
    ],
    BATCH_STATE: [['default_token', 'token-default'], ['running', 'false']]
  });

  const ash = await scrivi('PokePortfolio-ash.xlsx', {
    CONFIG: [
      ['key', 'value'],
      ['hidden_sets', '["20"]'],
      ['portfolio_prices_updated', dataSheets('2026-07-02 03:00:00')]
    ],
    PORTFOLIO: [
      ['portfolio_id', 'card_id', 'quantity', 'condition', 'language', 'finish', 'date_added', 'blueprint_id', 'last_price'],
      [ID_CHARIZARD, '10_1', 1, 'Near Mint', 'ENG', 'Holofoil', dataSheets('2026-06-01 10:30:00'), 1, 320],
      [ID_PIKACHU, '10_2', 3, 'Lightly Played', 'ITA', 'Normal', '2026-06-02 11:00:00', '', ''],
      ['', '', '', '', '', '', '', '', '']
    ],
    WISHLIST: [
      ['wishlist_id', 'card_id', 'quantity', 'condition', 'language', 'finish', 'date_added', 'blueprint_id', 'last_price'],
      [ID_DESIDERIO, '20_3', 1, 'Near Mint', 'JPN', 'Normal', dataSheets('2026-06-03 09:00:00'), 3, 18.5]
    ],
    PRICE_HISTORY: [
      ['timestamp', 'total_value'],
      [dataSheets('2026-07-01 03:00:00'), 310],
      [dataSheets('2026-07-02 03:00:00'), 327.5]
    ],
    CARD_PRICE_HISTORY: [
      ['timestamp', ID_CHARIZARD, ID_ELIMINATO, ID_PIKACHU],
      [dataSheets('2026-07-01 03:00:00'), 300, 5, ''],
      [dataSheets('2026-07-02 03:00:00'), 320, '', 2.5]
    ],
    WISHLIST_PRICE_HISTORY: [
      ['timestamp', ID_DESIDERIO],
      [dataSheets('2026-07-02 03:00:00'), 18.5]
    ]
  });

  return { master, ash };
}

test('import completo dai fogli Google', async () => {
  const file = await fileDiProva();
  const riepilogo = await importa(await leggiMaster(file.master), { ash: await leggiFileUtente(file.ash) });

  assert.deepEqual(
    { ...riepilogo, avvisi: riepilogo.avvisi.length },
    { sets: 2, carte: 3, utenti: 2, voci: 3, puntiStorico: 4, valori: 2, avvisi: 1 }
  );
  assert.match(riepilogo.avvisi[0], /Misty: nessun file utente/);

  // Password di prima; l'hash viene convertito al primo login.
  const accesso = await rpc(app, 'login', 'ash', 'pikachu1');
  assert.equal(accesso.success, true);
  const token = accesso.token;

  const lista = await rpc(app, 'getSetList', token);
  assert.deepEqual(lista.hidden_set_ids, ['20']);
  assert.equal(lista.sets.find((s) => s.set_id === '10').release_date, '1999-01-09');

  const portfolio = (await rpc(app, 'getPortfolio', token)).items;
  assert.deepEqual(portfolio.map((v) => v.portfolio_id), [ID_CHARIZARD, ID_PIKACHU]);
  // Data da orologio di Sheets restituita identica.
  assert.equal(portfolio[0].date_added, '2026-06-01 10:30:00');
  assert.equal(portfolio[1].date_added, '2026-06-02 11:00:00');
  assert.equal(portfolio[0].last_price, 320);
  assert.equal(portfolio[1].last_price, null);

  const storico = (await rpc(app, 'getCardsPriceHistory', token)).history;
  assert.deepEqual(storico[ID_CHARIZARD], [
    { t: '2026-07-01 03:00:00', price: 300 }, { t: '2026-07-02 03:00:00', price: 320 }
  ]);
  assert.deepEqual(storico[ID_PIKACHU], [{ t: '2026-07-02 03:00:00', price: 2.5 }]);
  assert.equal(storico[ID_ELIMINATO], undefined);

  const desideri = (await rpc(app, 'getWishlistCardsPriceHistory', token)).history;
  assert.deepEqual(desideri[ID_DESIDERIO], [{ t: '2026-07-02 03:00:00', price: 18.5 }]);

  const valori = (await rpc(app, 'getPriceHistory', token)).rows;
  assert.deepEqual(valori, [
    { timestamp: '2026-07-01 03:00:00', value: 310 }, { timestamp: '2026-07-02 03:00:00', value: 327.5 }
  ]);
  const dashboard = await rpc(app, 'getDashboardData', token);
  assert.equal(dashboard.last_updated, '2026-07-02 03:00:00');
  assert.equal(dashboard.total_cards, 4);

  // Key personale tenuta, copia del token di default tolta.
  const { rows } = await pool.query('SELECT username, cardtrader_api_key FROM users ORDER BY id');
  assert.deepEqual(rows, [
    { username: 'ash', cardtrader_api_key: 'key-personale-ash' },
    { username: 'Misty', cardtrader_api_key: null }
  ]);
  const { rows: [token_default] } = await pool.query(`SELECT value FROM settings WHERE key = 'default_token'`);
  assert.equal(token_default.value, 'token-default');
});

test("l'import rifiuta un database con utenti e non lascia dati a metà", async () => {
  const file = await fileDiProva();
  const master = await leggiMaster(file.master);
  await importa(master, {});
  await assert.rejects(importa(master, {}), /contiene già degli utenti/);
  const { rows } = await pool.query('SELECT count(*) AS n FROM users');
  assert.equal(rows[0].n, 2);
});
