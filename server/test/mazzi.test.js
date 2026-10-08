// Collezione di gioco e mazzi: parti pure e funzioni RPC su un database
// vero (vedi setup.js). GitHub è simulato sostituendo fetch.

import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import {
  avviaSyncTcg, chiaveDiGioco, nomeDiGioco, leggiListaMazzo, nomeEnergiaBase, setDaScaricare
} from '../src/services/tcg.js';
import { calcolaDisponibilita, avvisiMazzo, testoLista } from '../src/services/mazzi.js';
import { preparaDatabase, rpc, nuovoUtente, simulaFetch, logMuto } from './helpers.js';

const app = buildApp({ logger: false });

before(() => app.ready());
after(async () => {
  await app.close();
  await pool.end();
});
beforeEach(preparaDatabase);
afterEach(() => mock.restoreAll());


// ---- GitHub simulato ----

const attacco = (name, damage) => ({ name, cost: ['Psychic'], damage, text: '' });
const pokemon = (id, number, name, mark, attacchi, extra = {}) => ({
  id, number, name, supertype: 'Pokémon', subtypes: ['Basic'], regulationMark: mark,
  attacks: attacchi, images: { small: `https://img/${id}.png`, large: `https://img/${id}_hires.png` }, ...extra
});
const allenatore = (id, number, name, mark, subtypes = ['Supporter']) => ({
  id, number, name, supertype: 'Trainer', subtypes, regulationMark: mark, rarity: 'Uncommon',
  images: { small: `https://img/${id}.png` }
});

const SET_GITHUB = [
  { id: 'sv2', name: 'Paldea Evolved', ptcgoCode: 'PAL', releaseDate: '2023/06/09' },
  { id: 'sv6', name: 'Twilight Masquerade', ptcgoCode: 'TWM', releaseDate: '2024/05/24' },
  { id: 'me1', name: 'Mega Evolution', ptcgoCode: 'MEG', releaseDate: '2025/09/26' },
  { id: 'sve', name: 'Scarlet & Violet Energies', ptcgoCode: 'SVE', releaseDate: '2023/03/31' },
  { id: 'base1', name: 'Base', ptcgoCode: 'BS', releaseDate: '1999/01/09' }
];

const CARTE_GITHUB = {
  sv2: [
    allenatore('sv2-172', '172', "Boss's Orders (Ghetsis)", 'G'),
    allenatore('sv2-185', '185', 'Iono', 'G')
  ],
  sv6: [
    pokemon('sv6-128', '128', 'Dreepy', 'H', [attacco('Petty Grudge', '10'), attacco('Bite', '40')]),
    pokemon('sv6-130', '130', 'Dragapult ex', 'H', [attacco('Phantom Dive', '200')],
            { subtypes: ['Stage 2', 'ex'], rarity: 'Double Rare' }),
    pokemon('sv6-200', '200', 'Dragapult ex', 'H', [attacco('Phantom Dive', '200')],
            { subtypes: ['Stage 2', 'ex'], rarity: 'Ultra Rare' })
  ],
  me1: [
    allenatore('me1-114', '114', "Boss's Orders", 'I'),
    allenatore('me1-131', '131', 'Ultra Ball', 'I', ['Item']),
    pokemon('me1-158', '158', 'Dreepy', 'I', [attacco('Ram', '20')])
  ],
  sve: [
    { id: 'sve-7', number: '7', name: 'Basic Darkness Energy', supertype: 'Energy', subtypes: ['Basic'] }
  ]
};

function githubSimulato() {
  return simulaFetch((url) => {
    if (url.endsWith('/sets/en.json')) return SET_GITHUB;
    const set = url.match(/\/cards\/en\/([^/]+)\.json$/);
    if (set && CARTE_GITHUB[set[1]]) return CARTE_GITHUB[set[1]];
    return { status: 404, body: {} };
  });
}

async function catalogoTcgDiProva() {
  const finto = githubSimulato();
  const { avviato, completata } = await avviaSyncTcg({ log: logMuto });
  assert.equal(avviato, true);
  await completata;
  finto.mock.restore();
}

const chiaveDi = async (idCarta) =>
  (await pool.query('SELECT game_key FROM tcg_cards WHERE id = $1', [idCarta])).rows[0].game_key;


// ════════════════════════════════════════════════════════════════════
// PARTI PURE
// ════════════════════════════════════════════════════════════════════

test('chiaveDiGioco: Allenatori per nome, Pokémon per nome ed effetti', () => {
  const boss1 = { name: "Boss's Orders (Ghetsis)", supertype: 'Trainer' };
  const boss2 = { name: 'Boss’s Orders', supertype: 'Trainer' };
  assert.equal(nomeDiGioco(boss1), "Boss's Orders");
  assert.equal(chiaveDiGioco(boss1), chiaveDiGioco(boss2));

  const dreepy = (attacchi) => ({ name: 'Dreepy', supertype: 'Pokémon', attacks: attacchi });
  assert.equal(chiaveDiGioco(dreepy([attacco('Bite', '40')])), chiaveDiGioco(dreepy([attacco('Bite', '40')])));
  assert.notEqual(chiaveDiGioco(dreepy([attacco('Bite', '40')])), chiaveDiGioco(dreepy([attacco('Ram', '20')])));
  // Il nome fra parentesi conta solo per gli Allenatori.
  assert.equal(nomeDiGioco({ name: 'Pikachu (Delta)', supertype: 'Pokémon' }), 'Pikachu (Delta)');

  assert.match(chiaveDiGioco({ name: 'Basic Fire Energy', supertype: 'Energy', subtypes: ['Basic'] }), /^B\|/);
  assert.match(chiaveDiGioco({ name: 'Jet Energy', supertype: 'Energy', subtypes: ['Special'] }), /^E\|/);
});

test('leggiListaMazzo: formato Limitless, intestazioni, righe senza set', () => {
  const { righe, nonCapite } = leggiListaMazzo([
    'Pokémon: 7', '4 Dreepy TWM 128', '3 Dragapult ex TWM 130', '',
    'Trainer: 2', "* 2 Boss's Orders", 'Energy: 5', '5 Basic {D} Energy SVE 7',
    'Total Cards: 14', 'riga senza senso'
  ].join('\n'));
  assert.deepEqual(righe.map((r) => [r.quantita, r.nome, r.sigla, r.numero]), [
    [4, 'Dreepy', 'TWM', '128'],
    [3, 'Dragapult ex', 'TWM', '130'],
    [2, "Boss's Orders", null, null],
    [5, 'Basic {D} Energy', 'SVE', '7']
  ]);
  assert.deepEqual(nonCapite, ['riga senza senso']);

  assert.equal(nomeEnergiaBase('Basic {D} Energy'), 'Basic Darkness Energy');
  assert.equal(nomeEnergiaBase('fire energy'), 'Basic Fire Energy');
  assert.equal(nomeEnergiaBase('Jet Energy'), null);
});

test('setDaScaricare: solo i set degli ultimi anni', () => {
  const scelti = setDaScaricare(SET_GITHUB, new Date('2026-10-08'));
  assert.deepEqual(scelti.map((s) => s.id), ['sv2', 'sv6', 'me1', 'sve']);
});

test('calcolaDisponibilita: i mazzi costruiti prima prendono le carte, il resto è proxy', () => {
  const collezione = new Map([['T|boss', 5], ['P|dreepy', 4]]);
  const mazzi = [
    { id: 'idea', name: 'Idea', built_at: null, created_at: '2026-01-01', carte: [{ game_key: 'T|boss', quantity: 4 }] },
    { id: 'b', name: 'Secondo', built_at: '2026-03-01', created_at: '2026-01-01', carte: [{ game_key: 'T|boss', quantity: 4 }] },
    { id: 'a', name: 'Primo', built_at: '2026-02-01', created_at: '2026-01-02',
      carte: [{ game_key: 'T|boss', quantity: 3 }, { game_key: 'B|basic fire energy', quantity: 8 }] }
  ];
  const { impegni, libere, perMazzo } = calcolaDisponibilita(collezione, mazzi);

  assert.deepEqual(impegni.get('T|boss'), [
    { deck_id: 'a', deck_name: 'Primo', quantity: 3 },
    { deck_id: 'b', deck_name: 'Secondo', quantity: 2 }
  ]);
  assert.equal(libere.get('T|boss'), 0);
  assert.equal(libere.get('P|dreepy'), 4);
  assert.deepEqual(perMazzo.get('b').get('T|boss'), { need: 4, have: 2, proxy: 2, missing: 0 });
  assert.deepEqual(perMazzo.get('idea').get('T|boss'), { need: 4, have: 0, proxy: 0, missing: 4 });
  // Le Energie base ci sono sempre e non si impegnano.
  assert.deepEqual(perMazzo.get('a').get('B|basic fire energy'), { need: 8, have: 8, proxy: 0, missing: 0 });
  assert.equal(impegni.has('B|basic fire energy'), false);
});

test('avvisiMazzo: 60 carte, 4 copie per nome, una ACE SPEC, carte ruotate', () => {
  const carta = (name, quantity, extra = {}) => ({
    name, quantity, game_key: 'X|' + name + (extra.variante || ''), supertype: 'Trainer', subtypes: [], legal: true, ...extra
  });
  const avvisi = avvisiMazzo([
    carta('Dreepy', 3, { supertype: 'Pokémon', subtypes: ['Basic'] }),
    carta('Dreepy', 2, { supertype: 'Pokémon', subtypes: ['Basic'], variante: '2' }),
    carta('Prime Catcher', 1, { subtypes: ['Item', 'ACE SPEC'] }),
    carta('Unfair Stamp', 1, { subtypes: ['Item', 'ACE SPEC'] }),
    carta('Iono', 1, { legal: false }),
    { name: 'Basic Fire Energy', quantity: 20, game_key: 'B|basic fire energy', supertype: 'Energy', subtypes: ['Basic'], legal: true }
  ]);
  assert.deepEqual(avvisi, [
    'Il mazzo ha 28 carte invece di 60.',
    'Dreepy: 5 copie, il massimo è 4.',
    'Più di una carta ACE SPEC: ne è ammessa una sola.',
    'Non legali in Standard: Iono.'
  ]);
});

test('testoLista: formato Pokémon TCG Live', () => {
  assert.equal(testoLista([
    { quantity: 4, name: 'Dreepy', set_code: 'TWM', number: '128', supertype: 'Pokémon' },
    { quantity: 2, name: "Boss's Orders", set_code: 'MEG', number: '114', supertype: 'Trainer' },
    { quantity: 3, name: 'Iono', set_code: 'PAL', number: '185', supertype: 'Trainer' }
  ]), "Pokémon: 4\n4 Dreepy TWM 128\n\nTrainer: 5\n2 Boss's Orders MEG 114\n3 Iono PAL 185");
});


// ════════════════════════════════════════════════════════════════════
// CATALOGO DA GIOCO
// ════════════════════════════════════════════════════════════════════

test('sync da GitHub: set recenti, stessa carta fra stampe diverse', async () => {
  await catalogoTcgDiProva();

  const { rows: set } = await pool.query('SELECT id, code FROM tcg_sets ORDER BY id');
  assert.deepEqual(set.map((s) => s.id), ['me1', 'sv2', 'sv6', 'sve']);

  assert.equal(await chiaveDi('sv2-172'), await chiaveDi('me1-114'));
  assert.equal(await chiaveDi('sv6-130'), await chiaveDi('sv6-200'));
  assert.notEqual(await chiaveDi('sv6-128'), await chiaveDi('me1-158'));
  const { rows: [boss] } = await pool.query(`SELECT name, subtypes FROM tcg_cards WHERE id = 'sv2-172'`);
  assert.deepEqual(boss, { name: "Boss's Orders", subtypes: ['Supporter'] });

  const token = await nuovoUtente(app, 'ash');
  const stato = await rpc(app, 'getTcgStatus', token);
  assert.equal(stato.cards_count, 9);
  assert.deepEqual(stato.standard_marks, ['H', 'I', 'J']);
  assert.equal(stato.is_owner, true);
});

test('ricerca: un risultato per carta di gioco, filtro sulle carte legali', async () => {
  await catalogoTcgDiProva();
  const token = await nuovoUtente(app, 'ash');

  const boss = await rpc(app, 'searchTcgCards', token, 'boss');
  assert.equal(boss.cards.length, 1);
  assert.equal(boss.cards[0].legal, true);
  assert.equal(boss.cards[0].card_id, 'me1-114', 'si mostra la stampa legale');
  assert.deepEqual(boss.cards[0].prints.map((p) => [p.set_code, p.legal]), [['MEG', true], ['PAL', false]]);

  assert.equal((await rpc(app, 'searchTcgCards', token, 'iono')).cards[0].legal, false);
  assert.equal((await rpc(app, 'searchTcgCards', token, 'iono', { legalOnly: true })).cards.length, 0);
  assert.equal((await rpc(app, 'searchTcgCards', token, 'dreepy')).cards.length, 2);
  assert.equal((await rpc(app, 'searchTcgCards', token, 'energy', { noBasicEnergy: true })).cards.length, 0);
});

test('lettere dello Standard: le cambia solo il proprietario', async () => {
  await catalogoTcgDiProva();
  const proprietario = await nuovoUtente(app, 'ash');
  const ospite = await nuovoUtente(app, 'misty');

  const rifiutato = await rpc(app, 'setStandardMarks', ospite, 'G,H,I');
  assert.equal(rifiutato.success, false);
  assert.match(rifiutato.error, /proprietario/);
  assert.equal((await rpc(app, 'startTcgSync', ospite)).success, false);
  assert.equal((await rpc(app, 'setStandardMarks', proprietario, 'x1')).success, false);

  assert.deepEqual(await rpc(app, 'setStandardMarks', proprietario, ' i, g h '), { success: true, standard_marks: ['G', 'H', 'I'] });
  assert.equal((await rpc(app, 'searchTcgCards', ospite, 'iono')).cards[0].legal, true);
});


// ════════════════════════════════════════════════════════════════════
// COLLEZIONE E MAZZI
// ════════════════════════════════════════════════════════════════════

test('collezione: solo carte legali, niente Energie base, copie per carta di gioco', async () => {
  await catalogoTcgDiProva();
  const token = await nuovoUtente(app, 'ash');
  const boss = await chiaveDi('sv2-172');

  assert.deepEqual(await rpc(app, 'addTcgCopies', token, boss, 2), { success: true, quantity: 2 });
  assert.deepEqual(await rpc(app, 'addTcgCopies', token, boss, 1), { success: true, quantity: 3 });

  const iono = await rpc(app, 'addTcgCopies', token, await chiaveDi('sv2-185'), 1);
  assert.equal(iono.success, false);
  assert.match(iono.error, /non è legale/);
  const energia = await rpc(app, 'setTcgCopies', token, await chiaveDi('sve-7'), 10);
  assert.match(energia.error, /Energie base/);
  assert.equal((await rpc(app, 'setTcgCopies', token, 'X|inesistente', 1)).error, 'Carta non trovata.');
  assert.equal((await rpc(app, 'setTcgCopies', token, boss, 1000)).success, false);

  const collezione = await rpc(app, 'getTcgCollection', token);
  assert.equal(collezione.items.length, 1);
  assert.deepEqual(
    (({ name, quantity, free, set_code, legal }) => ({ name, quantity, free, set_code, legal }))(collezione.items[0]),
    { name: "Boss's Orders", quantity: 3, free: 3, set_code: 'MEG', legal: true }
  );
  assert.deepEqual(collezione.stats, { total: 3, distinct: 1, free: 3, in_decks: 0 });

  assert.deepEqual(await rpc(app, 'addTcgCopies', token, boss, -5), { success: true, quantity: 0 });
  assert.equal((await rpc(app, 'getTcgCollection', token)).items.length, 0);
});

test('mazzi: import, confronto con la collezione, mazzo costruito e proxy', async () => {
  await catalogoTcgDiProva();
  const token = await nuovoUtente(app, 'ash');
  await rpc(app, 'setTcgCopies', token, await chiaveDi('me1-114'), 3);   // Boss's Orders
  await rpc(app, 'setTcgCopies', token, await chiaveDi('sv6-200'), 2);   // Dragapult ex

  const creato = await rpc(app, 'createDeck', token, '  Dragapult  ', [
    'Pokémon: 7', '3 Dragapult ex TWM 130', '4 Dreepy TWM 128',
    'Trainer: 4', "4 Boss's Orders PAL 172",
    'Energy: 5', '5 Basic {D} Energy SVE 7', '1 Pippo XYZ 1'
  ].join('\n'));
  assert.equal(creato.success, true);
  assert.equal(creato.imported, 16);
  assert.deepEqual(creato.unrecognized, ['1 Pippo XYZ 1']);

  const { deck } = await rpc(app, 'getDeck', token, creato.deck_id);
  assert.equal(deck.name, 'Dragapult');
  assert.deepEqual([deck.total, deck.have, deck.missing, deck.proxy], [16, 10, 6, 0]);
  const riga = (d, id) => d.sections.flatMap((s) => s.cards).find((c) => c.card_id === id);
  assert.deepEqual([riga(deck, 'sv6-130').have, riga(deck, 'sv6-130').missing], [2, 1]);
  assert.deepEqual([riga(deck, 'sv2-172').have, riga(deck, 'sv2-172').missing], [3, 1]);
  assert.equal(riga(deck, 'sve-7').have, 5);
  assert.deepEqual(deck.sections.map((s) => [s.title, s.count]), [['Pokémon', 7], ['Allenatori', 4], ['Energie', 5]]);
  assert.match(deck.list_text, /^Pokémon: 7\n3 Dragapult ex TWM 130\n4 Dreepy TWM 128\n\nTrainer: 4\n4 Boss's Orders PAL 172/);

  // Costruito: le carte mancanti diventano proxy e le copie si impegnano.
  await rpc(app, 'setDeckBuilt', token, creato.deck_id, true);
  const costruito = (await rpc(app, 'getDeck', token, creato.deck_id)).deck;
  assert.deepEqual([costruito.built, costruito.missing, costruito.proxy], [true, 0, 6]);

  const collezione = await rpc(app, 'getTcgCollection', token);
  const bossInCollezione = collezione.items.find((i) => i.name === "Boss's Orders");
  assert.equal(bossInCollezione.free, 0);
  assert.deepEqual(bossInCollezione.in_decks, [{ deck_id: creato.deck_id, deck_name: 'Dragapult', quantity: 3 }]);
  assert.deepEqual(collezione.stats, { total: 5, distinct: 2, free: 0, in_decks: 5 });

  // Un secondo mazzo vede che le carte ci sono, ma sono nel primo.
  const secondo = await rpc(app, 'createDeck', token, 'Prova', "2 Boss's Orders MEG 114");
  const boss2 = riga((await rpc(app, 'getDeck', token, secondo.deck_id)).deck, 'me1-114');
  assert.deepEqual([boss2.have, boss2.missing, boss2.owned_total], [0, 2, 3]);
  assert.deepEqual(boss2.in_other_decks, [{ deck_id: creato.deck_id, deck_name: 'Dragapult', quantity: 3 }]);

  // Smontato il primo, le copie tornano libere.
  await rpc(app, 'setDeckBuilt', token, creato.deck_id, false);
  const dopo = riga((await rpc(app, 'getDeck', token, secondo.deck_id)).deck, 'me1-114');
  assert.deepEqual([dopo.have, dopo.missing], [2, 0]);

  const elenco = await rpc(app, 'getDecks', token);
  assert.deepEqual(elenco.decks.map((d) => [d.name, d.built, d.missing]), [['Prova', false, 0], ['Dragapult', false, 6]]);
});

test('mazzi: modifiche a mano, lista sostituita, duplica ed elimina', async () => {
  await catalogoTcgDiProva();
  const token = await nuovoUtente(app, 'ash');
  const { deck_id: id } = await rpc(app, 'createDeck', token, 'Vuoto', '');

  assert.equal((await rpc(app, 'setDeckCard', token, id, 'me1-131', 4)).success, true);
  assert.equal((await rpc(app, 'setDeckCard', token, id, 'sv6-128', 2)).success, true);
  assert.equal((await rpc(app, 'setDeckCard', token, id, 'me1-131', 3)).quantity, 3);
  assert.equal((await rpc(app, 'setDeckCard', token, id, 'sv6-128', 0)).success, true);
  assert.equal((await rpc(app, 'setDeckCard', token, id, 'inesistente', 1)).error, 'Carta non trovata.');
  assert.equal((await rpc(app, 'setDeckCard', token, id, 'me1-131', 61)).success, false);
  assert.equal((await rpc(app, 'getDeck', token, id)).deck.list_text, 'Trainer: 3\n3 Ultra Ball MEG 131');

  const sostituita = await rpc(app, 'replaceDeckList', token, id, '4 Dreepy TWM 128\n2 Ultra Ball');
  assert.equal(sostituita.imported, 6);
  assert.equal((await rpc(app, 'getDeck', token, id)).deck.list_text, 'Pokémon: 4\n4 Dreepy TWM 128\n\nTrainer: 2\n2 Ultra Ball MEG 131');

  assert.deepEqual(await rpc(app, 'renameDeck', token, id, 'Dreepy'), { success: true, name: 'Dreepy' });
  assert.equal((await rpc(app, 'renameDeck', token, id, '   ')).success, false);

  const copia = await rpc(app, 'duplicateDeck', token, id);
  const duplicato = (await rpc(app, 'getDeck', token, copia.deck_id)).deck;
  assert.deepEqual([duplicato.name, duplicato.total], ['Dreepy (copia)', 6]);

  assert.equal((await rpc(app, 'deleteDeck', token, id)).success, true);
  assert.equal((await rpc(app, 'getDeck', token, id)).error, 'Mazzo non trovato.');
  assert.equal((await rpc(app, 'getDeck', token, 'non-un-uuid')).error, 'Mazzo non trovato.');
});

test('collezione e mazzi sono privati', async () => {
  await catalogoTcgDiProva();
  const ash = await nuovoUtente(app, 'ash');
  const misty = await nuovoUtente(app, 'misty');
  await rpc(app, 'setTcgCopies', ash, await chiaveDi('me1-114'), 4);
  const { deck_id: id } = await rpc(app, 'createDeck', ash, 'Segreto', '4 Dreepy TWM 128');

  assert.equal((await rpc(app, 'getTcgCollection', misty)).items.length, 0);
  assert.deepEqual((await rpc(app, 'getDecks', misty)).decks, []);
  for (const [funzione, ...argomenti] of [
    ['getDeck', id], ['renameDeck', id, 'x'], ['setDeckCard', id, 'sv6-128', 1],
    ['setDeckBuilt', id, true], ['replaceDeckList', id, ''], ['duplicateDeck', id], ['deleteDeck', id]
  ]) {
    assert.equal((await rpc(app, funzione, misty, ...argomenti)).error, 'Mazzo non trovato.', funzione);
  }
  assert.equal((await rpc(app, 'getDeck', ash, id)).deck.total, 4);
  assert.deepEqual(await rpc(app, 'getDecks', 'token-falso'), { success: false, error: 'UNAUTHORIZED' });
});

test('le sezioni Collezione e Mazzi ci sono solo nella pagina desktop', async () => {
  const desktop = (await app.inject({ method: 'GET', url: '/?mobile=0' })).body;
  assert.match(desktop, /window\.apriSezioneTcg = function/);
  assert.match(desktop, /id="section-mazzi"/);
  assert.doesNotMatch(desktop, /^\s*<\?!=/m);

  const mobile = (await app.inject({ method: 'GET', url: '/?mobile=1' })).body;
  assert.doesNotMatch(mobile, /apriSezioneTcg = function/);
});
