// Test end-to-end delle funzioni RPC su un database vero (vedi setup.js).
// CardTrader e GitHub sono simulati sostituendo fetch.

import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { avviaSyncCatalogo } from '../src/services/catalog.js';
import { avviaAggiornamentoPrezzi } from '../src/services/prices.js';
import { assegnaKeyDiDefaultAgliUtentiSenzaKey } from '../src/services/settings.js';
import {
  preparaDatabase, rpc, nuovoUtente, simulaFetch, logMuto,
  keyValida, rispostaInfoCardTrader, autorizzazioniChiamate
} from './helpers.js';

const app = buildApp({ logger: false });

before(() => app.ready());
after(async () => {
  await app.close();
  await pool.end();
});
beforeEach(preparaDatabase);
afterEach(() => mock.restoreAll());


// ---- CardTrader simulato: un set Pokémon, uno escluso, uno di un altro gioco ----

const BLUEPRINT_SET_10 = [1, 2, 3].map((id) => ({
  id,
  name: id === 1 ? 'Pikachu' : `Carta ${id}`,
  category_id: 73,
  image_url: `https://img/${id}.jpg`,
  fixed_properties: { collector_number: String(id), pokemon_rarity: 'Common' },
  editable_properties: [{ name: 'pokemon_language', default_value: 'en' }]
}));

function cardTraderSimulato({ prezzoCentesimi = 250 } = {}) {
  return simulaFetch((url, opzioni) => {
    const info = rispostaInfoCardTrader(url, opzioni);
    if (info) return info;
    if (url.includes('raw.githubusercontent.com')) {
      return [{ name: 'Base Set', images: { logo: 'https://logo/base.png' }, releaseDate: '1999/01/09' }];
    }
    if (url.endsWith('/expansions')) {
      return [
        { id: 10, game_id: 5, name: 'Base Set' },
        { id: 1468, game_id: 5, name: 'Escluso' },
        { id: 99, game_id: 1, name: 'Magic' }
      ];
    }
    if (url.includes('/blueprints/export?expansion_id=10')) return BLUEPRINT_SET_10;
    if (url.includes('/marketplace/products')) {
      const idBlueprint = new URL(url).searchParams.get('blueprint_id');
      return { [idBlueprint]: [{ price: { cents: prezzoCentesimi, currency: 'EUR' }, properties_hash: { condition: 'Near Mint' } }] };
    }
    return { status: 404, body: {} };
  });
}

async function catalogoDiProva() {
  cardTraderSimulato();
  const { completata } = await avviaSyncCatalogo({ mode: 'sync', log: logMuto });
  await completata;
}


// ════════════════════════════════════════════════════════════════════
// SESSIONE
// ════════════════════════════════════════════════════════════════════

test('registrazione, login, checkSession e logout', async () => {
  cardTraderSimulato();
  assert.deepEqual(await rpc(app, 'register', 'ash', 'pikachu1', keyValida('ash')), { success: true });
  assert.equal((await rpc(app, 'register', 'ASH', 'altra', keyValida('ash2'))).error, 'Nome utente già in uso.');
  assert.equal((await rpc(app, 'register', 'ab', 'x', keyValida('ab'))).success, false);
  mock.restoreAll();

  assert.equal((await rpc(app, 'login', 'ash', 'sbagliata')).error, 'Nome utente o password errati.');
  const accesso = await rpc(app, 'login', 'Ash', 'pikachu1');
  assert.equal(accesso.success, true);
  assert.equal(accesso.username, 'ash');

  assert.deepEqual(await rpc(app, 'checkSession', accesso.token), { valid: true, username: 'ash' });
  await rpc(app, 'logout', accesso.token);
  assert.deepEqual(await rpc(app, 'checkSession', accesso.token), { valid: false });
});

test('registrazione: la key CardTrader è obbligatoria e viene verificata', async () => {
  const finto = cardTraderSimulato();

  const senzaKey = await rpc(app, 'register', 'ash', 'pikachu1', '   ');
  assert.equal(senzaKey.success, false);
  assert.match(senzaKey.error, /obbligatoria/);

  const rifiutata = await rpc(app, 'register', 'ash', 'pikachu1', 'key-sbagliata');
  assert.equal(rifiutata.success, false);
  assert.match(rifiutata.error, /CardTrader ha rifiutato questa API key/);

  // La key di default del proprietario (ambiente o settings) non si usa
  // per registrarsi, e non viene nemmeno mandata a CardTrader.
  await pool.query(`INSERT INTO settings (key, value) VALUES ('default_token', 'key-valida-del-proprietario')`);
  for (const key of ['token-di-test', 'key-valida-del-proprietario']) {
    const conDefault = await rpc(app, 'register', 'ash', 'pikachu1', key);
    assert.equal(conDefault.success, false);
    assert.match(conDefault.error, /non si può usare/);
  }
  assert.deepEqual(autorizzazioniChiamate(finto, '/info'), ['Bearer key-sbagliata']);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  assert.equal(rows[0].n, 0);

  assert.equal((await rpc(app, 'register', 'ash', 'pikachu1', ' key-valida-ash ')).success, true);
  const { rows: [ash] } = await pool.query(`SELECT cardtrader_api_key FROM users WHERE username = 'ash'`);
  assert.equal(ash.cardtrader_api_key, 'key-valida-ash');
});

test('registrazione: con CardTrader irraggiungibile l\'account non viene creato', async () => {
  simulaFetch(() => { throw new Error('rete assente'); });
  // Salto le pause fra un tentativo e l'altro (1, 2, 3 secondi, vedi
  // chiamaCardTrader). Gli altri timer, per esempio quelli di pg, restano
  // quelli veri.
  const setTimeoutVero = globalThis.setTimeout;
  const pause = mock.method(globalThis, 'setTimeout', (funzione, ms, ...argomenti) => {
    if (ms >= 1000 && ms <= 3000) { funzione(...argomenti); return 0; }
    return setTimeoutVero(funzione, ms, ...argomenti);
  });

  const esito = await rpc(app, 'register', 'ash', 'pikachu1', keyValida('ash'));
  pause.mock.restore();
  assert.equal(esito.success, false);
  assert.match(esito.error, /Riprova tra qualche minuto/);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  assert.equal(rows[0].n, 0);
});

test('due utenti restano collegati contemporaneamente', async () => {
  const tokenAsh = await nuovoUtente(app, 'ash');
  const tokenMisty = await nuovoUtente(app, 'misty');
  assert.equal((await rpc(app, 'checkSession', tokenAsh)).username, 'ash');
  assert.equal((await rpc(app, 'checkSession', tokenMisty)).username, 'misty');
});

test('hash SHA-256 importato da Sheets: login riuscito e conversione a scrypt', async () => {
  const sha = createHash('sha256').update('vecchia', 'utf8').digest('hex');
  await pool.query(`INSERT INTO users (username, password_hash, hash_algo) VALUES ('brock', $1, 'sha256')`, [sha]);

  assert.equal((await rpc(app, 'login', 'brock', 'vecchia')).success, true);
  const { rows } = await pool.query(`SELECT hash_algo FROM users WHERE username = 'brock'`);
  assert.equal(rows[0].hash_algo, 'scrypt');
  assert.equal((await rpc(app, 'login', 'brock', 'vecchia')).success, true);
});

test('le funzioni protette rifiutano token assenti o non validi', async () => {
  assert.deepEqual(await rpc(app, 'getPortfolio', 'token-falso'), { success: false, error: 'UNAUTHORIZED' });
  assert.deepEqual(await rpc(app, 'getSetList', null), { success: false, error: 'UNAUTHORIZED' });
  const prezzo = await rpc(app, 'getPriceForVariant', 'token-falso', 'x', 'Near Mint', 'ENG', 'Normal');
  assert.equal(prezzo.message, 'UNAUTHORIZED');
  assert.match((await rpc(app, 'funzioneInesistente')).error, /sconosciuta/);
});


// ════════════════════════════════════════════════════════════════════
// CATALOGO
// ════════════════════════════════════════════════════════════════════

test('sync del catalogo: filtra i set, salva set e carte, poi li legge', async () => {
  const token = await nuovoUtente(app, 'ash');
  assert.equal((await rpc(app, 'getSetList', token)).empty, true);

  await catalogoDiProva();

  const lista = await rpc(app, 'getSetList', token);
  assert.equal(lista.sets.length, 1);
  assert.deepEqual(lista.sets[0], {
    set_id: '10', set_name: 'Base Set', set_series: 'INT', set_logo_url: 'https://logo/base.png',
    release_date: '1999-01-09', total_cards: 3, ct_expansion_id: 10
  });
  assert.equal(lista.sync_running, false);
  assert.match(lista.last_sync, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const carte = await rpc(app, 'getCardsForSet', token, '10');
  assert.equal(carte.cards.length, 3);
  assert.equal(carte.cards.find((c) => c.id === '10_1').name, 'Pikachu');

  const ricerca = await rpc(app, 'searchCards', token, 'pika');
  assert.deepEqual(ricerca.cards.map((c) => c.id), ['10_1']);
  assert.deepEqual((await rpc(app, 'searchCards', token, '%')).cards, []);

  const perId = await rpc(app, 'getCardsForIds', token, ['10_2', 'inesistente']);
  assert.deepEqual(perId.cards.map((c) => c.id), ['10_2']);
});

test('una seconda sync non riscrive i set già presenti; il refresh riscrive solo quelli cambiati', async () => {
  await catalogoDiProva();
  const { completata: sync } = await avviaSyncCatalogo({ mode: 'sync', log: logMuto });
  assert.equal(await sync, 0);

  const { completata: refreshUguale } = await avviaSyncCatalogo({ mode: 'refresh', log: logMuto });
  assert.equal(await refreshUguale, 0);

  BLUEPRINT_SET_10.push({ ...BLUEPRINT_SET_10[0], id: 4, name: 'Nuova' });
  try {
    const { completata: refresh } = await avviaSyncCatalogo({ mode: 'refresh', log: logMuto });
    assert.equal(await refresh, 1);
    const { rows } = await pool.query('SELECT count(*) AS n FROM cards WHERE set_id = 10');
    assert.equal(rows[0].n, 4);
  } finally {
    BLUEPRINT_SET_10.pop();
  }
});

test('refresh manuale di un set e set nascosti', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();

  const refresh = await rpc(app, 'refreshSet', token, '10');
  assert.equal(refresh.success, true);
  assert.equal(refresh.cards_before, 3);
  assert.equal(refresh.set.total_cards, 3);
  assert.equal((await rpc(app, 'refreshSet', token, '777')).error, 'Set non trovato nel catalogo.');

  assert.deepEqual((await rpc(app, 'setSetHidden', token, '10', true)).hidden_set_ids, ['10']);
  assert.deepEqual((await rpc(app, 'getSetList', token)).hidden_set_ids, ['10']);
  assert.deepEqual((await rpc(app, 'setSetHidden', token, '10', false)).hidden_set_ids, []);
});

test('una sola sync alla volta', async () => {
  const token = await nuovoUtente(app, 'ash');
  cardTraderSimulato();
  const prima = await avviaSyncCatalogo({ mode: 'sync', log: logMuto });
  assert.equal(prima.avviato, true);

  assert.equal((await avviaSyncCatalogo({ mode: 'sync', log: logMuto })).avviato, false);
  assert.equal((await rpc(app, 'startRefreshAllSets', token)).error, 'Sincronizzazione del catalogo già in corso.');
  assert.equal((await rpc(app, 'getCatalogSyncStatus', token)).running, true);

  await prima.completata;
  assert.equal((await rpc(app, 'getCatalogSyncStatus', token)).running, false);
});


// ════════════════════════════════════════════════════════════════════
// PORTFOLIO, WISHLIST, PREZZI, AMICI
// ════════════════════════════════════════════════════════════════════

test('portfolio: aggiunta, quantità, eliminazione, dashboard ed export', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();

  const aggiunta = await rpc(app, 'addToPortfolio', token, '10_1', 2, 'Near Mint', 'ENG', 'Normal', 1);
  assert.equal(aggiunta.success, true);
  const idVoce = aggiunta.portfolio_id;
  await rpc(app, 'addToPortfolio', token, '10_2', 1, 'Near Mint', 'ITA', 'Normal', 2);

  assert.equal((await rpc(app, 'incrementPortfolioItem', token, idVoce, 1)).new_quantity, 3);
  assert.equal((await rpc(app, 'incrementPortfolioItem', token, idVoce, -3)).success, false);
  assert.equal((await rpc(app, 'incrementPortfolioItem', token, 'non-un-uuid', 1)).error, 'Voce non trovata.');

  const portfolio = await rpc(app, 'getPortfolio', token);
  assert.equal(portfolio.items.length, 2);
  assert.equal(portfolio.items[0].portfolio_id, idVoce);
  assert.equal(portfolio.items[0].last_price, null);

  const dashboard = await rpc(app, 'getDashboardData', token);
  assert.deepEqual(dashboard, { success: true, total_value: null, last_updated: null, total_cards: 4, total_sets: 1 });

  const esportazione = await rpc(app, 'exportPortfolioData', token);
  assert.equal(esportazione.rows[0].nome_carta, 'Pikachu');
  assert.equal(esportazione.rows[0].set, 'Base Set');

  assert.equal((await rpc(app, 'deletePortfolioItem', token, idVoce)).success, true);
  assert.equal((await rpc(app, 'getPortfolio', token)).items.length, 1);
});

test('le voci di un utente non sono accessibili a un altro', async () => {
  const tokenAsh = await nuovoUtente(app, 'ash');
  const tokenMisty = await nuovoUtente(app, 'misty');
  const { portfolio_id } = await rpc(app, 'addToPortfolio', tokenAsh, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);

  assert.equal((await rpc(app, 'deletePortfolioItem', tokenMisty, portfolio_id)).error, 'Voce non trovata.');
  assert.equal((await rpc(app, 'getPortfolio', tokenMisty)).items.length, 0);
  // Stesso id, lista sbagliata.
  assert.equal((await rpc(app, 'deleteWishlistItem', tokenAsh, portfolio_id)).error, 'Voce non trovata.');
});

test('prezzo in tempo reale: aggiorna last_price della variante e la dashboard', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', token, '10_1', 2, 'Near Mint', 'ENG', 'Normal', 1);
  await rpc(app, 'addToWishlist', token, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);

  const prezzo = await rpc(app, 'getPriceForVariant', token, '10_1', 'Near Mint', 'ENG', 'Normal');
  assert.deepEqual(prezzo, { success: true, price: 2.5, currency: 'EUR', message: null });

  assert.equal((await rpc(app, 'getPortfolio', token)).items[0].last_price, 2.5);
  // La wishlist non viene toccata dal prezzo del portfolio.
  assert.equal((await rpc(app, 'getWishlist', token)).items[0].last_price, null);

  const dashboard = await rpc(app, 'getDashboardData', token);
  assert.equal(dashboard.total_value, 5);
  assert.match(dashboard.last_updated, /^\d{4}-\d{2}-\d{2} /);
});

test('prezzi: si usa solo la key dell\'utente, senza key nessuna chiamata', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', token, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);

  let finto = cardTraderSimulato();
  await rpc(app, 'getPriceForVariant', token, '10_1', 'Near Mint', 'ENG', 'Normal');
  assert.deepEqual(autorizzazioniChiamate(finto, '/marketplace/products'), ['Bearer key-valida-ash']);

  // Utente senza key (per esempio importato): né prezzo in tempo reale né
  // batch chiamano CardTrader, nemmeno con la key di default.
  await pool.query(`UPDATE users SET cardtrader_api_key = NULL`);
  mock.restoreAll();
  finto = cardTraderSimulato();
  const prezzo = await rpc(app, 'getPriceForVariant', token, '10_1', 'Near Mint', 'ENG', 'Normal');
  assert.deepEqual(prezzo, { success: false, price: null, message: 'API key CardTrader mancante.' });

  const { completata } = await avviaAggiornamentoPrezzi({ log: logMuto });
  assert.equal(await completata, 0);
  assert.equal(finto.mock.callCount(), 0);
});

test('batch prezzi: ogni utente con la sua key', async () => {
  const tokenAsh = await nuovoUtente(app, 'ash');
  const tokenMisty = await nuovoUtente(app, 'misty');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', tokenAsh, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);
  await rpc(app, 'addToPortfolio', tokenMisty, '10_2', 1, 'Near Mint', 'ENG', 'Normal', 2);

  mock.restoreAll();
  const finto = cardTraderSimulato();
  const { completata } = await avviaAggiornamentoPrezzi({ log: logMuto });
  assert.equal(await completata, 2);
  assert.deepEqual(autorizzazioniChiamate(finto, '/marketplace/products'),
    ['Bearer key-valida-ash', 'Bearer key-valida-misty']);
});

test('avvio: agli utenti senza key va CARDTRADER_DEFAULT_TOKEN', async () => {
  await pool.query(`INSERT INTO users (username, password_hash, hash_algo) VALUES ('brock', 'x', 'sha256')`);
  await nuovoUtente(app, 'ash');

  assert.equal(await assegnaKeyDiDefaultAgliUtentiSenzaKey(), 1);
  assert.equal(await assegnaKeyDiDefaultAgliUtentiSenzaKey(), 0);
  const { rows } = await pool.query('SELECT username, cardtrader_api_key FROM users ORDER BY id');
  assert.deepEqual(rows, [
    { username: 'brock', cardtrader_api_key: 'token-di-test' },
    { username: 'ash', cardtrader_api_key: 'key-valida-ash' }
  ]);
});

test('batch prezzi: aggiorna tutti, scrive storico per voce e valore totale', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();
  const { portfolio_id } = await rpc(app, 'addToPortfolio', token, '10_1', 2, 'Near Mint', 'ENG', 'Normal', 1);
  const { wishlist_id } = await rpc(app, 'addToWishlist', token, '10_2', 1, 'Near Mint', 'ENG', 'Normal', 2);

  cardTraderSimulato({ prezzoCentesimi: 400 });
  const { completata } = await avviaAggiornamentoPrezzi({ log: logMuto });
  assert.equal(await completata, 2);

  const storicoPortfolio = (await rpc(app, 'getCardsPriceHistory', token)).history;
  assert.deepEqual(storicoPortfolio[portfolio_id].map((p) => p.price), [4]);
  const storicoWishlist = (await rpc(app, 'getWishlistCardsPriceHistory', token)).history;
  assert.deepEqual(storicoWishlist[wishlist_id].map((p) => p.price), [4]);

  // Il totale conta solo il portfolio: 2 copie × 4 €.
  const valori = (await rpc(app, 'getPriceHistory', token)).rows;
  assert.deepEqual(valori.map((r) => r.value), [8]);
  assert.equal((await rpc(app, 'getDashboardData', token)).total_value, 8);
});

test('amici: elenco senza se stessi e portfolio in sola lettura con le carte', async () => {
  const tokenAsh = await nuovoUtente(app, 'ash');
  const tokenMisty = await nuovoUtente(app, 'misty');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', tokenMisty, '10_3', 1, 'Near Mint', 'ENG', 'Normal', 3);

  const amici = await rpc(app, 'getFriends', tokenAsh);
  assert.deepEqual(amici.items.map((a) => a.username), ['misty']);

  const portfolioMisty = await rpc(app, 'getFriendPortfolio', tokenAsh, amici.items[0].sheet_id);
  assert.equal(portfolioMisty.items.length, 1);
  assert.equal(portfolioMisty.cards['10_3'].name, 'Carta 3');
  assert.equal((await rpc(app, 'getFriendPortfolio', tokenAsh, 'abc')).success, false);
});


// ════════════════════════════════════════════════════════════════════
// PAGINE E CRON
// ════════════════════════════════════════════════════════════════════

test('le pagine includono script.html e lo shim di google.script.run', async () => {
  const desktop = await app.inject({ method: 'GET', url: '/' });
  assert.equal(desktop.statusCode, 200);
  assert.match(desktop.body, /<script src="\/gas-shim.js"><\/script>/);
  assert.match(desktop.body, /function gasCall\(/);
  assert.doesNotMatch(desktop.body, /^\s*<\?!=/m);

  const mobile = await app.inject({ method: 'GET', url: '/?mobile=1' });
  assert.match(mobile.body, /window\._isMobile = true/);
  assert.match(mobile.body, /function gasCall\(/);

  assert.equal((await app.inject({ method: 'GET', url: '/gas-shim.js' })).statusCode, 200);
});

test('endpoint cron: richiede il segreto', async () => {
  const senza = await app.inject({ method: 'POST', url: '/api/cron/prices' });
  assert.equal(senza.statusCode, 401);

  const conSegreto = await app.inject({
    method: 'POST', url: '/api/cron/prices', headers: { authorization: 'Bearer segreto-di-test' }
  });
  assert.equal(conSegreto.statusCode, 202);
  // Attendo la fine del giro (nessun utente: termina subito).
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query(`SELECT status FROM job_runs WHERE job = 'prices'`);
    if (rows[0]?.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 20));
  }
});
