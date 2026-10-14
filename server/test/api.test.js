// Test end-to-end delle funzioni RPC su un database vero (vedi setup.js).
// CardTrader e GitHub sono simulati sostituendo fetch.

import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { avviaSyncCatalogo } from '../src/services/catalog.js';
import { avviaAggiornamentoPrezzi } from '../src/services/prices.js';
import { config } from '../src/config.js';
import { creaLinkReset } from '../src/services/auth.js';
import {
  preparaDatabase, rpc, nuovoUtente, simulaFetch, logMuto, autorizzazioniChiamate
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
  return simulaFetch((url) => {
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
  // Per registrarsi non serve nessuna key e CardTrader non viene chiamato.
  const finto = simulaFetch(() => ({ status: 404, body: {} }));
  assert.deepEqual(await rpc(app, 'register', 'ash', 'pikachu1'), { success: true });
  assert.equal((await rpc(app, 'register', 'ASH', 'altra')).error, 'Nome utente già in uso.');
  assert.equal((await rpc(app, 'register', 'ab', 'x')).success, false);
  assert.equal(finto.mock.callCount(), 0);
  mock.restoreAll();

  assert.equal((await rpc(app, 'login', 'ash', 'sbagliata')).error, 'Nome utente o password errati.');
  const accesso = await rpc(app, 'login', 'Ash', 'pikachu1');
  assert.equal(accesso.success, true);
  assert.equal(accesso.username, 'ash');

  assert.deepEqual(await rpc(app, 'checkSession', accesso.token), { valid: true, username: 'ash' });
  await rpc(app, 'logout', accesso.token);
  assert.deepEqual(await rpc(app, 'checkSession', accesso.token), { valid: false });
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

test('troppi tentativi di login dallo stesso IP: risposta che il frontend mostra', async () => {
  const appLimitata = buildApp({ logger: false, limiteAccessiAlMinuto: 3 });
  await appLimitata.ready();
  try {
    const tenta = (ip) => appLimitata.inject({
      method: 'POST', url: '/api/rpc/login', payload: ['ash', 'sbagliata'],
      headers: { 'x-forwarded-for': ip }
    });
    for (let i = 0; i < 3; i++) {
      assert.equal((await tenta('203.0.113.1')).json().error, 'Nome utente o password errati.');
    }
    const bloccato = await tenta('203.0.113.1');
    assert.equal(bloccato.statusCode, 200);
    assert.deepEqual(bloccato.json(), { success: false, error: 'Troppi tentativi, riprova tra qualche minuto.' });

    // Un altro IP e le altre funzioni non sono toccati.
    assert.equal((await tenta('203.0.113.2')).json().error, 'Nome utente o password errati.');
    const sessione = await appLimitata.inject({
      method: 'POST', url: '/api/rpc/checkSession', payload: ['x'], headers: { 'x-forwarded-for': '203.0.113.1' }
    });
    assert.deepEqual(sessione.json(), { valid: false });
  } finally {
    await appLimitata.close();
  }
});

test('le funzioni protette rifiutano token assenti o non validi', async () => {
  assert.deepEqual(await rpc(app, 'getPortfolio', 'token-falso'), { success: false, error: 'UNAUTHORIZED' });
  assert.deepEqual(await rpc(app, 'getSetList', null), { success: false, error: 'UNAUTHORIZED' });
  const prezzo = await rpc(app, 'getPriceForVariant', 'token-falso', 'x', 'Near Mint', 'ENG', 'Normal');
  assert.equal(prezzo.message, 'UNAUTHORIZED');
  assert.match((await rpc(app, 'funzioneInesistente')).error, /sconosciuta/);
});


test('password dimenticata: link monouso, chiude le sessioni', async () => {
  const vecchioToken = await nuovoUtente(app, 'ash', 'pikachu1');
  const vecchio = await creaLinkReset('ASH');
  const { username, codice } = await creaLinkReset('ash');
  assert.equal(username, 'ash');

  // Nel database c'è solo l'hash; il link nuovo annulla quello vecchio.
  const { rows } = await pool.query('SELECT code_hash FROM password_resets');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].code_hash, codice);
  assert.match((await rpc(app, 'getPasswordReset', vecchio.codice)).error, /non valido o scaduto/);

  assert.deepEqual(await rpc(app, 'getPasswordReset', codice), { success: true, username: 'ash' });
  assert.match((await rpc(app, 'resetPassword', codice, 'corta')).error, /almeno 8 caratteri/);
  assert.deepEqual(await rpc(app, 'resetPassword', codice, 'charizard99'), { success: true, username: 'ash' });

  // Una volta sola; sessioni chiuse; vale solo la password nuova.
  assert.equal((await rpc(app, 'resetPassword', codice, 'altrapassword')).success, false);
  assert.deepEqual(await rpc(app, 'checkSession', vecchioToken), { valid: false });
  assert.equal((await rpc(app, 'login', 'ash', 'pikachu1')).success, false);
  assert.equal((await rpc(app, 'login', 'ash', 'charizard99')).success, true);

  // Link scaduto.
  const scaduto = await creaLinkReset('ash');
  await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 second'`);
  assert.equal((await rpc(app, 'getPasswordReset', scaduto.codice)).success, false);
  assert.equal((await rpc(app, 'resetPassword', scaduto.codice, 'nuovapassword')).success, false);

  await assert.rejects(creaLinkReset('nessuno'), /non trovato/);
});

test('cambio password: serve quella attuale, restano aperte solo questa sessione', async () => {
  const token = await nuovoUtente(app, 'ash', 'pikachu1');
  const altroDispositivo = (await rpc(app, 'login', 'ash', 'pikachu1')).token;
  const { codice } = await creaLinkReset('ash');

  assert.match((await rpc(app, 'changePassword', token, 'sbagliata', 'charizard99')).error, /attuale non è corretta/);
  assert.match((await rpc(app, 'changePassword', token, 'pikachu1', 'corta')).error, /almeno 8 caratteri/);
  assert.deepEqual(await rpc(app, 'changePassword', token, 'pikachu1', 'charizard99'), { success: true });

  assert.deepEqual(await rpc(app, 'checkSession', token), { valid: true, username: 'ash' });
  assert.deepEqual(await rpc(app, 'checkSession', altroDispositivo), { valid: false });
  // Un link di reset ancora aperto non vale più.
  assert.equal((await rpc(app, 'getPasswordReset', codice)).success, false);
  assert.equal((await rpc(app, 'login', 'ash', 'charizard99')).success, true);
  assert.equal((await rpc(app, 'changePassword', 'token-finto', 'x', 'y')).error, 'UNAUTHORIZED');
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

test('prezzi: si usa la key del proprietario, senza key nessuna chiamata', async () => {
  const token = await nuovoUtente(app, 'ash');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', token, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);

  let finto = cardTraderSimulato();
  await rpc(app, 'getPriceForVariant', token, '10_1', 'Near Mint', 'ENG', 'Normal');
  assert.deepEqual(autorizzazioniChiamate(finto, '/marketplace/products'), ['Bearer token-di-test']);

  // Senza key del proprietario né il prezzo in tempo reale né il batch
  // chiamano CardTrader.
  const keyOriginale = config.cardTraderDefaultToken;
  config.cardTraderDefaultToken = '';
  try {
    mock.restoreAll();
    finto = cardTraderSimulato();
    const prezzo = await rpc(app, 'getPriceForVariant', token, '10_1', 'Near Mint', 'ENG', 'Normal');
    assert.deepEqual(prezzo, { success: false, price: null, message: 'API key CardTrader mancante.' });

    const { completata } = await avviaAggiornamentoPrezzi({ log: logMuto });
    await assert.rejects(completata, /Nessuna API key/);
    assert.equal(finto.mock.callCount(), 0);
  } finally {
    config.cardTraderDefaultToken = keyOriginale;
  }
});

test('batch prezzi: una chiamata per carta, lingua e foil, anche fra utenti diversi', async () => {
  const tokenAsh = await nuovoUtente(app, 'ash');
  const tokenMisty = await nuovoUtente(app, 'misty');
  await catalogoDiProva();
  await rpc(app, 'addToPortfolio', tokenAsh, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);
  await rpc(app, 'addToWishlist', tokenAsh, '10_1', 1, 'Lightly Played', 'ENG', 'Normal', 1);
  await rpc(app, 'addToPortfolio', tokenMisty, '10_1', 1, 'Near Mint', 'ENG', 'Normal', 1);
  await rpc(app, 'addToPortfolio', tokenMisty, '10_1', 1, 'Near Mint', 'ITA', 'Normal', 1);
  await rpc(app, 'addToPortfolio', tokenMisty, '10_1', 1, 'Near Mint', 'ENG', 'Holofoil', 1);
  await rpc(app, 'addToPortfolio', tokenMisty, '10_2', 1, 'Near Mint', 'ENG', 'Normal', 2);

  mock.restoreAll();
  const finto = cardTraderSimulato({ prezzoCentesimi: 400 });
  const { completata } = await avviaAggiornamentoPrezzi({ log: logMuto });
  assert.equal(await completata, 6);

  // 10_1 inglese, 10_1 italiana, 10_1 foil, 10_2: quattro chiamate.
  assert.deepEqual(autorizzazioniChiamate(finto, '/marketplace/products'), Array(4).fill('Bearer token-di-test'));
  const { rows } = await pool.query('SELECT DISTINCT last_price FROM collection_items');
  assert.deepEqual(rows.map((r) => Number(r.last_price)), [4]);
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
  assert.match(mobile.body, /<script>window\._isMobile = true;<\/script>/);
  assert.match(mobile.body, /function gasCall\(/);

  assert.equal((await app.inject({ method: 'GET', url: '/gas-shim.js' })).statusCode, 200);
});

test('gli smartphone ricevono la versione mobile senza ?mobile=1', async () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  for (const ua of [iphone, android]) {
    const pagina = await app.inject({ method: 'GET', url: '/', headers: { 'user-agent': ua } });
    assert.match(pagina.body, /<script>window\._isMobile = true;<\/script>/);
  }
  const tablet = await app.inject({ method: 'GET', url: '/', headers: { 'user-agent': ipad } });
  assert.doesNotMatch(tablet.body, /<script>window\._isMobile = true;<\/script>/);

  const forzata = await app.inject({ method: 'GET', url: '/?mobile=0', headers: { 'user-agent': iphone } });
  assert.doesNotMatch(forzata.body, /<script>window\._isMobile = true;<\/script>/);
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
