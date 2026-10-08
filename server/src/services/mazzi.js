// ════════════════════════════════════════════════════════════════════
// mazzi.js — COLLEZIONE DI GIOCO E MAZZI
// ════════════════════════════════════════════════════════════════════
// Collezione: quante copie ha l'utente di ogni carta di gioco (game_key,
// vedi tcg.js), senza prezzi né condizioni. Si accettano solo carte
// legali in Standard; le Energie base non si contano mai (si danno per
// possedute).
//
// Mazzi: liste di carte. Un mazzo "costruito" (built_at valorizzato)
// impegna le sue carte: chi lo ha costruito per primo le prende per primo,
// quelle che non bastano sono proxy. I mazzi ancora da costruire si
// confrontano solo con le copie libere. Niente di tutto questo è salvato:
// si ricalcola a ogni lettura (calcolaDisponibilita).
// ════════════════════════════════════════════════════════════════════

import { pool, transazione } from '../db/pool.js';
import { ErroreApi } from '../lib/errori.js';
import { formatDate } from '../lib/date.js';
import {
  leggiLettereStandard, leggiGruppi, leggiCarta, risolviListaMazzo,
  eChiaveEnergiaBase, normalizzaNome
} from './tcg.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASSIMO_COPIE_COLLEZIONE = 999;
const MASSIMO_COPIE_IN_MAZZO = 60;
const MASSIMO_CARTE_DIVERSE_IN_MAZZO = 60;
const MASSIMO_MAZZI = 100;
const LUNGHEZZA_MASSIMA_NOME = 60;
const LUNGHEZZA_MASSIMA_LISTA = 20_000;
export const CARTE_IN_UN_MAZZO = 60;


// ════════════════════════════════════════════════════════════════════
// DISPONIBILITÀ (parte pura)
// ════════════════════════════════════════════════════════════════════

// collezione: Map game_key → copie possedute
// mazzi: [{ id, name, built_at, created_at, carte: [{ game_key, quantity }] }]
//
// Restituisce:
//   impegni:  Map game_key → [{ deck_id, deck_name, quantity }] copie
//             prese dai mazzi costruiti;
//   libere:   Map game_key → copie non impegnate;
//   perMazzo: Map deck_id → Map game_key → { need, have, proxy, missing }
//             (proxy solo per i mazzi costruiti, missing per gli altri).
export function calcolaDisponibilita(collezione, mazzi) {
  const libere = new Map(collezione);
  const impegni = new Map();
  const perMazzo = new Map();

  const richiesteDi = (mazzo) => {
    const richieste = new Map();
    for (const c of mazzo.carte) richieste.set(c.game_key, (richieste.get(c.game_key) || 0) + c.quantity);
    return richieste;
  };

  const costruiti = mazzi
    .filter((m) => m.built_at)
    .sort((a, b) => (new Date(a.built_at) - new Date(b.built_at)) ||
                    (new Date(a.created_at) - new Date(b.created_at)) ||
                    String(a.id).localeCompare(String(b.id)));

  for (const mazzo of costruiti) {
    const esito = new Map();
    for (const [chiave, servono] of richiesteDi(mazzo)) {
      if (eChiaveEnergiaBase(chiave)) {
        esito.set(chiave, { need: servono, have: servono, proxy: 0, missing: 0 });
        continue;
      }
      const prese = Math.min(servono, libere.get(chiave) || 0);
      if (prese > 0) {
        libere.set(chiave, libere.get(chiave) - prese);
        if (!impegni.has(chiave)) impegni.set(chiave, []);
        impegni.get(chiave).push({ deck_id: mazzo.id, deck_name: mazzo.name, quantity: prese });
      }
      esito.set(chiave, { need: servono, have: prese, proxy: servono - prese, missing: 0 });
    }
    perMazzo.set(mazzo.id, esito);
  }

  for (const mazzo of mazzi.filter((m) => !m.built_at)) {
    const esito = new Map();
    for (const [chiave, servono] of richiesteDi(mazzo)) {
      const ho = eChiaveEnergiaBase(chiave) ? servono : Math.min(servono, libere.get(chiave) || 0);
      esito.set(chiave, { need: servono, have: ho, proxy: 0, missing: servono - ho });
    }
    perMazzo.set(mazzo.id, esito);
  }

  return { impegni, libere, perMazzo };
}

// Regole di costruzione dello Standard, come avvisi (non bloccano nulla).
// carte: [{ name, game_key, quantity, supertype, subtypes, legal }]
export function avvisiMazzo(carte) {
  const avvisi = [];
  const totale = carte.reduce((s, c) => s + c.quantity, 0);
  if (totale !== CARTE_IN_UN_MAZZO) avvisi.push(`Il mazzo ha ${totale} carte invece di ${CARTE_IN_UN_MAZZO}.`);

  // Massimo 4 copie per NOME (anche fra Pokémon con attacchi diversi).
  const perNome = new Map();
  for (const c of carte) {
    if (eChiaveEnergiaBase(c.game_key)) continue;
    const nome = normalizzaNome(c.name);
    const voce = perNome.get(nome) || { name: c.name, quantity: 0 };
    voce.quantity += c.quantity;
    perNome.set(nome, voce);
  }
  for (const { name, quantity } of perNome.values()) {
    if (quantity > 4) avvisi.push(`${name}: ${quantity} copie, il massimo è 4.`);
  }

  const conSottotipo = (sottotipo) => carte
    .filter((c) => (c.subtypes || []).includes(sottotipo))
    .reduce((s, c) => s + c.quantity, 0);
  if (conSottotipo('ACE SPEC') > 1) avvisi.push('Più di una carta ACE SPEC: ne è ammessa una sola.');
  if (conSottotipo('Radiant') > 1) avvisi.push('Più di un Pokémon Radiante: ne è ammesso uno solo.');

  const haBase = carte.some((c) => c.supertype === 'Pokémon' && (c.subtypes || []).includes('Basic'));
  if (carte.length && !haBase) avvisi.push('Nessun Pokémon Base nel mazzo.');

  const nonLegali = carte.filter((c) => !c.legal).map((c) => c.name);
  if (nonLegali.length) avvisi.push(`Non legali in Standard: ${[...new Set(nonLegali)].join(', ')}.`);
  return avvisi;
}


// ════════════════════════════════════════════════════════════════════
// LETTURA DEI DATI DI UN UTENTE
// ════════════════════════════════════════════════════════════════════

async function leggiCollezione(idUtente) {
  const { rows } = await pool.query(
    'SELECT game_key, card_id, name, quantity, added_at FROM tcg_collection WHERE user_id = $1',
    [idUtente]
  );
  return rows;
}

async function leggiMazzi(idUtente) {
  const [{ rows: mazzi }, { rows: carte }] = await Promise.all([
    pool.query(
      'SELECT id, name, built_at, created_at, updated_at FROM decks WHERE user_id = $1 ORDER BY created_at, id',
      [idUtente]
    ),
    pool.query(
      `SELECT dc.deck_id, dc.card_id, dc.game_key, dc.name, dc.quantity, dc.position
         FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
        WHERE d.user_id = $1 ORDER BY dc.position, dc.card_id`,
      [idUtente]
    )
  ]);
  const perMazzo = new Map(mazzi.map((m) => [m.id, { ...m, carte: [] }]));
  for (const c of carte) perMazzo.get(c.deck_id)?.carte.push(c);
  return [...perMazzo.values()];
}

// Tutto quello che serve a collezione e mazzi in un colpo solo.
async function contesto(idUtente) {
  const [collezione, mazzi, lettere] = await Promise.all([
    leggiCollezione(idUtente), leggiMazzi(idUtente), leggiLettereStandard()
  ]);
  const disponibilita = calcolaDisponibilita(
    new Map(collezione.map((r) => [r.game_key, r.quantity])), mazzi
  );
  return { collezione, mazzi, lettere, disponibilita };
}

function controllaIdMazzo(id) {
  if (!UUID.test(String(id || ''))) throw new ErroreApi('Mazzo non trovato.');
  return String(id);
}

async function mazzoDellUtente(idUtente, idMazzo, client = pool) {
  const { rows } = await client.query(
    'SELECT id, name, built_at FROM decks WHERE id = $1 AND user_id = $2',
    [controllaIdMazzo(idMazzo), idUtente]
  );
  if (!rows.length) throw new ErroreApi('Mazzo non trovato.');
  return rows[0];
}

function nomeMazzoValido(nome) {
  const pulito = String(nome || '').replace(/\s+/g, ' ').trim();
  if (!pulito) throw new ErroreApi('Dai un nome al mazzo.');
  if (pulito.length > LUNGHEZZA_MASSIMA_NOME) throw new ErroreApi(`Il nome può avere al massimo ${LUNGHEZZA_MASSIMA_NOME} caratteri.`);
  return pulito;
}


// ════════════════════════════════════════════════════════════════════
// COLLEZIONE
// ════════════════════════════════════════════════════════════════════

export async function getCollezione(idUtente) {
  const { collezione, mazzi, lettere, disponibilita } = await contesto(idUtente);
  const gruppi = await leggiGruppi(collezione.map((r) => r.game_key), lettere);
  const nomeMazzo = new Map(mazzi.map((m) => [m.id, m.name]));

  const items = collezione.map((riga) => {
    const gruppo = gruppi.get(riga.game_key);
    const stampa = gruppo?.prints.find((p) => p.card_id === riga.card_id) || gruppo?.prints[0];
    const impegni = disponibilita.impegni.get(riga.game_key) || [];
    return {
      game_key:    riga.game_key,
      name:        gruppo?.name || riga.name,
      supertype:   gruppo?.supertype || '',
      subtypes:    gruppo?.subtypes || [],
      legal:       gruppo ? gruppo.legal : false,
      found:       !!gruppo,
      card_id:     riga.card_id,
      set_code:    stampa?.set_code || '',
      number:      stampa?.number || '',
      image_small: stampa?.image_small || '',
      image_large: stampa?.image_large || '',
      prints:      gruppo ? gruppo.prints.map((p) => `${p.set_code} ${p.number}`) : [],
      quantity:    riga.quantity,
      free:        disponibilita.libere.get(riga.game_key) ?? riga.quantity,
      in_decks:    impegni.map((i) => ({ deck_id: i.deck_id, deck_name: nomeMazzo.get(i.deck_id) || i.deck_name, quantity: i.quantity })),
      added_at:    formatDate(riga.added_at)
    };
  });

  items.sort((a, b) => ordineTipo(a.supertype) - ordineTipo(b.supertype) || a.name.localeCompare(b.name));
  const totale = items.reduce((s, i) => s + i.quantity, 0);
  const libere = items.reduce((s, i) => s + i.free, 0);
  return {
    success: true,
    items,
    stats: { total: totale, distinct: items.length, free: libere, in_decks: totale - libere }
  };
}

const ORDINE_TIPI = ['Pokémon', 'Trainer', 'Energy'];
const ordineTipo = (tipo) => (ORDINE_TIPI.includes(tipo) ? ORDINE_TIPI.indexOf(tipo) : ORDINE_TIPI.length);

// Carta che si può aggiungere alla collezione: esiste, è legale in
// Standard e non è un'Energia base.
async function cartaAggiungibile(chiave) {
  const gruppo = (await leggiGruppi([chiave], await leggiLettereStandard())).get(chiave);
  if (!gruppo) throw new ErroreApi('Carta non trovata.');
  if (gruppo.basic_energy) throw new ErroreApi('Le Energie base non serve segnarle: si danno per possedute.');
  if (!gruppo.legal) throw new ErroreApi(`${gruppo.name} non è legale nel formato Standard attuale.`);
  return gruppo;
}

const MESSAGGIO_MASSIMO = `Al massimo ${MASSIMO_COPIE_COLLEZIONE} copie.`;

// Imposta le copie possedute di una carta (0 = toglierla).
export async function impostaCopie(idUtente, gameKey, quantita) {
  const chiave = String(gameKey || '');
  const copie = parseInt(quantita, 10);
  if (!chiave) throw new ErroreApi('Carta non valida.');
  if (!Number.isInteger(copie) || copie < 0) throw new ErroreApi('Numero di copie non valido.');
  if (copie > MASSIMO_COPIE_COLLEZIONE) throw new ErroreApi(MESSAGGIO_MASSIMO);

  if (copie === 0) {
    await pool.query('DELETE FROM tcg_collection WHERE user_id = $1 AND game_key = $2', [idUtente, chiave]);
    return { success: true, quantity: 0 };
  }

  const { rowCount } = await pool.query(
    'UPDATE tcg_collection SET quantity = $3 WHERE user_id = $1 AND game_key = $2',
    [idUtente, chiave, copie]
  );
  if (rowCount) return { success: true, quantity: copie };

  const gruppo = await cartaAggiungibile(chiave);
  await pool.query(
    `INSERT INTO tcg_collection (user_id, game_key, card_id, name, quantity) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, game_key) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [idUtente, chiave, gruppo.card_id, gruppo.name, copie]
  );
  return { success: true, quantity: copie };
}

// Aggiunge (o toglie) copie. Ogni passo è una sola istruzione SQL: due
// clic ravvicinati su +1 contano entrambi.
export async function aggiungiCopie(idUtente, gameKey, delta) {
  const chiave = String(gameKey || '');
  const variazione = parseInt(delta, 10);
  if (!chiave) throw new ErroreApi('Carta non valida.');
  if (!Number.isInteger(variazione) || variazione === 0) throw new ErroreApi('Variazione non valida.');
  if (Math.abs(variazione) > MASSIMO_COPIE_COLLEZIONE) throw new ErroreApi(MESSAGGIO_MASSIMO);

  if (variazione < 0) {
    const { rows } = await pool.query(
      `UPDATE tcg_collection SET quantity = quantity + $3
        WHERE user_id = $1 AND game_key = $2 AND quantity + $3 > 0 RETURNING quantity`,
      [idUtente, chiave, variazione]
    );
    if (rows.length) return { success: true, quantity: rows[0].quantity };
    await pool.query('DELETE FROM tcg_collection WHERE user_id = $1 AND game_key = $2', [idUtente, chiave]);
    return { success: true, quantity: 0 };
  }

  const { rows } = await pool.query(
    `UPDATE tcg_collection SET quantity = quantity + $3
      WHERE user_id = $1 AND game_key = $2 AND quantity + $3 <= $4 RETURNING quantity`,
    [idUtente, chiave, variazione, MASSIMO_COPIE_COLLEZIONE]
  );
  if (rows.length) return { success: true, quantity: rows[0].quantity };

  const { rowCount: esiste } = await pool.query(
    'SELECT 1 FROM tcg_collection WHERE user_id = $1 AND game_key = $2', [idUtente, chiave]
  );
  if (esiste) throw new ErroreApi(MESSAGGIO_MASSIMO);

  const gruppo = await cartaAggiungibile(chiave);
  const { rows: [riga] } = await pool.query(
    `INSERT INTO tcg_collection (user_id, game_key, card_id, name, quantity) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, game_key)
     DO UPDATE SET quantity = LEAST(tcg_collection.quantity + EXCLUDED.quantity, $6)
     RETURNING quantity`,
    [idUtente, chiave, gruppo.card_id, gruppo.name, variazione, MASSIMO_COPIE_COLLEZIONE]
  );
  return { success: true, quantity: riga.quantity };
}


// ════════════════════════════════════════════════════════════════════
// MAZZI: LETTURA
// ════════════════════════════════════════════════════════════════════

const TITOLI_SEZIONI = { 'Pokémon': 'Pokémon', Trainer: 'Allenatori', Energy: 'Energie' };
const INTESTAZIONI_LISTA = { 'Pokémon': 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };

// Dettaglio delle carte di un mazzo: righe per stampa, disponibilità per
// carta di gioco. Se due righe sono la stessa carta (es. 2 Boss's Orders
// PAL + 2 MEG) le copie disponibili si distribuiscono nell'ordine della lista.
function dettaglioCarte(mazzo, ctx, gruppi) {
  const { disponibilita, mazzi } = ctx;
  const esito = disponibilita.perMazzo.get(mazzo.id) || new Map();
  const nomeMazzo = new Map(mazzi.map((m) => [m.id, m.name]));
  const collezione = new Map(ctx.collezione.map((r) => [r.game_key, r.quantity]));

  const restante = new Map();
  for (const [chiave, e] of esito) restante.set(chiave, e.have);

  return mazzo.carte.map((carta) => {
    const gruppo = gruppi.get(carta.game_key);
    const stampa = gruppo?.prints.find((p) => p.card_id === carta.card_id);
    const disponibili = restante.get(carta.game_key) || 0;
    const ho = Math.min(carta.quantity, disponibili);
    restante.set(carta.game_key, disponibili - ho);
    const mancano = carta.quantity - ho;

    const altrove = (disponibilita.impegni.get(carta.game_key) || [])
      .filter((i) => i.deck_id !== mazzo.id)
      .map((i) => ({ deck_id: i.deck_id, deck_name: nomeMazzo.get(i.deck_id) || i.deck_name, quantity: i.quantity }));

    return {
      card_id:       carta.card_id,
      game_key:      carta.game_key,
      name:          gruppo?.name || carta.name,
      supertype:     gruppo?.supertype || '',
      subtypes:      gruppo?.subtypes || [],
      set_code:      stampa?.set_code || '',
      number:        stampa?.number || '',
      image_small:   stampa?.image_small || gruppo?.image_small || '',
      image_large:   stampa?.image_large || gruppo?.image_large || '',
      legal:         gruppo ? gruppo.legal : false,
      found:         !!gruppo,
      basic_energy:  eChiaveEnergiaBase(carta.game_key),
      quantity:      carta.quantity,
      have:          ho,
      // Mazzo costruito: le copie che mancano sono proxy.
      missing:       mazzo.built_at ? 0 : mancano,
      proxy:         mazzo.built_at ? mancano : 0,
      owned_total:   collezione.get(carta.game_key) || 0,
      in_other_decks: mancano > 0 ? altrove : []
    };
  });
}

// Immagine del mazzo: il primo Pokémon "di punta" (ex, V…), altrimenti
// il primo Pokémon, altrimenti la prima carta.
const SOTTOTIPI_DI_PUNTA = ['ex', 'V', 'VSTAR', 'VMAX', 'MEGA'];
function copertina(righe) {
  const conImmagine = righe.filter((r) => r.image_small);
  const pokemon = conImmagine.filter((r) => r.supertype === 'Pokémon');
  const scelta = pokemon.find((r) => r.subtypes.some((s) => SOTTOTIPI_DI_PUNTA.includes(s))) || pokemon[0] || conImmagine[0];
  return scelta ? scelta.image_small : '';
}

function riepilogo(mazzo, righe) {
  const somma = (campo) => righe.reduce((s, r) => s + r[campo], 0);
  return {
    id:         mazzo.id,
    name:       mazzo.name,
    built:      !!mazzo.built_at,
    built_at:   formatDate(mazzo.built_at),
    created_at: formatDate(mazzo.created_at),
    total:      somma('quantity'),
    have:       somma('have'),
    missing:    somma('missing'),
    proxy:      somma('proxy'),
    cover:      copertina(righe)
  };
}

export function testoLista(righe) {
  const blocchi = [];
  for (const tipo of ORDINE_TIPI) {
    const diTipo = righe.filter((r) => r.supertype === tipo);
    if (!diTipo.length) continue;
    const totale = diTipo.reduce((s, r) => s + r.quantity, 0);
    blocchi.push([`${INTESTAZIONI_LISTA[tipo]}: ${totale}`,
      ...diTipo.map((r) => [r.quantity, r.name, r.set_code, r.number].filter((x) => x !== '').join(' '))].join('\n'));
  }
  const senzaTipo = righe.filter((r) => !ORDINE_TIPI.includes(r.supertype));
  if (senzaTipo.length) blocchi.push(senzaTipo.map((r) => `${r.quantity} ${r.name}`).join('\n'));
  return blocchi.join('\n\n');
}

export async function getMazzi(idUtente) {
  const ctx = await contesto(idUtente);
  const gruppi = await leggiGruppi(ctx.mazzi.flatMap((m) => m.carte.map((c) => c.game_key)), ctx.lettere);
  // ctx.mazzi è in ordine di creazione: dal più recente, poi prima i
  // costruiti (sort è stabile).
  const decks = ctx.mazzi.slice().reverse().map((mazzo) => {
    const righe = dettaglioCarte(mazzo, ctx, gruppi);
    return { ...riepilogo(mazzo, righe), warnings: avvisiMazzo(righe).length };
  });
  decks.sort((a, b) => b.built - a.built);
  return { success: true, decks };
}

export async function getMazzo(idUtente, idMazzo) {
  const { id } = await mazzoDellUtente(idUtente, idMazzo);
  const ctx = await contesto(idUtente);
  const mazzo = ctx.mazzi.find((m) => m.id === id);
  const righe = dettaglioCarte(mazzo, ctx, await leggiGruppi(mazzo.carte.map((c) => c.game_key), ctx.lettere));

  const sezioni = ORDINE_TIPI.map((tipo) => ({ supertype: tipo, title: TITOLI_SEZIONI[tipo], cards: righe.filter((r) => r.supertype === tipo) }));
  const senzaTipo = righe.filter((r) => !ORDINE_TIPI.includes(r.supertype));
  if (senzaTipo.length) sezioni.push({ supertype: '', title: 'Non trovate nel catalogo', cards: senzaTipo });

  return {
    success: true,
    deck: {
      ...riepilogo(mazzo, righe),
      warnings:  avvisiMazzo(righe),
      list_text: testoLista(righe),
      sections:  sezioni
        .filter((s) => s.cards.length)
        .map((s) => ({ ...s, count: s.cards.reduce((n, c) => n + c.quantity, 0) }))
    }
  };
}


// ════════════════════════════════════════════════════════════════════
// MAZZI: MODIFICHE
// ════════════════════════════════════════════════════════════════════

async function scriviCarte(tx, idMazzo, carte) {
  if (carte.length > MASSIMO_CARTE_DIVERSE_IN_MAZZO) {
    throw new ErroreApi(`Un mazzo può avere al massimo ${MASSIMO_CARTE_DIVERSE_IN_MAZZO} carte diverse.`);
  }
  await tx.query('DELETE FROM deck_cards WHERE deck_id = $1', [idMazzo]);
  if (!carte.length) return;
  await tx.query(
    `INSERT INTO deck_cards (deck_id, card_id, game_key, name, quantity, position)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[])`,
    [idMazzo, carte.map((c) => c.card_id), carte.map((c) => c.game_key), carte.map((c) => c.name),
     carte.map((c) => c.quantity), carte.map((_, i) => i)]
  );
}

async function leggiListaIncollata(lista) {
  const testo = String(lista || '');
  if (testo.length > LUNGHEZZA_MASSIMA_LISTA) throw new ErroreApi('La lista è troppo lunga.');
  return risolviListaMazzo(testo);
}

function esitoImport(idMazzo, risolta) {
  return {
    success:      true,
    deck_id:      idMazzo,
    imported:     risolta.carte.reduce((s, c) => s + c.quantity, 0),
    unrecognized: risolta.nonRiconosciute,
    to_check:     risolta.daControllare
  };
}

export async function creaMazzo(idUtente, nome, lista) {
  const nomePulito = nomeMazzoValido(nome);
  const risolta = await leggiListaIncollata(lista);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM decks WHERE user_id = $1', [idUtente]);
  if (rows[0].n >= MASSIMO_MAZZI) throw new ErroreApi(`Puoi avere al massimo ${MASSIMO_MAZZI} mazzi.`);

  const idMazzo = await transazione(async (tx) => {
    const { rows: [mazzo] } = await tx.query(
      'INSERT INTO decks (user_id, name) VALUES ($1, $2) RETURNING id', [idUtente, nomePulito]
    );
    await scriviCarte(tx, mazzo.id, risolta.carte);
    return mazzo.id;
  });
  return esitoImport(idMazzo, risolta);
}

// Sostituisce tutte le carte del mazzo con quelle della lista incollata.
export async function sostituisciLista(idUtente, idMazzo, lista) {
  const risolta = await leggiListaIncollata(lista);
  await transazione(async (tx) => {
    await mazzoDellUtente(idUtente, idMazzo, tx);
    await scriviCarte(tx, idMazzo, risolta.carte);
    await tx.query('UPDATE decks SET updated_at = now() WHERE id = $1', [idMazzo]);
  });
  return esitoImport(idMazzo, risolta);
}

export async function rinominaMazzo(idUtente, idMazzo, nome) {
  const nomePulito = nomeMazzoValido(nome);
  await mazzoDellUtente(idUtente, idMazzo);
  await pool.query('UPDATE decks SET name = $2, updated_at = now() WHERE id = $1', [idMazzo, nomePulito]);
  return { success: true, name: nomePulito };
}

// Copie di una carta nel mazzo (0 = toglierla). Le carte nuove vanno in
// fondo alla lista.
export async function impostaCartaMazzo(idUtente, idMazzo, idCarta, quantita) {
  const copie = parseInt(quantita, 10);
  if (!Number.isInteger(copie) || copie < 0 || copie > MASSIMO_COPIE_IN_MAZZO) {
    throw new ErroreApi('Numero di copie non valido.');
  }
  await mazzoDellUtente(idUtente, idMazzo);
  const id = String(idCarta || '');

  if (copie === 0) {
    await pool.query('DELETE FROM deck_cards WHERE deck_id = $1 AND card_id = $2', [idMazzo, id]);
  } else {
    const { rowCount } = await pool.query(
      'UPDATE deck_cards SET quantity = $3 WHERE deck_id = $1 AND card_id = $2', [idMazzo, id, copie]
    );
    if (!rowCount) {
      const carta = await leggiCarta(id);
      if (!carta) throw new ErroreApi('Carta non trovata.');
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n, COALESCE(max(position), -1) + 1 AS pos FROM deck_cards WHERE deck_id = $1', [idMazzo]
      );
      if (rows[0].n >= MASSIMO_CARTE_DIVERSE_IN_MAZZO) {
        throw new ErroreApi(`Un mazzo può avere al massimo ${MASSIMO_CARTE_DIVERSE_IN_MAZZO} carte diverse.`);
      }
      await pool.query(
        `INSERT INTO deck_cards (deck_id, card_id, game_key, name, quantity, position) VALUES ($1, $2, $3, $4, $5, $6)`,
        [idMazzo, carta.id, carta.game_key, carta.name, copie, rows[0].pos]
      );
    }
  }
  await pool.query('UPDATE decks SET updated_at = now() WHERE id = $1', [idMazzo]);
  return { success: true, quantity: copie };
}

// Costruito = le sue carte vengono impegnate (da adesso: chi è stato
// costruito prima ha la precedenza). Smontato = tornano libere.
export async function impostaCostruito(idUtente, idMazzo, costruito) {
  await mazzoDellUtente(idUtente, idMazzo);
  await pool.query(
    `UPDATE decks SET built_at = CASE WHEN $2 THEN COALESCE(built_at, now()) ELSE NULL END,
                      updated_at = now()
      WHERE id = $1`,
    [idMazzo, !!costruito]
  );
  return { success: true, built: !!costruito };
}

export async function duplicaMazzo(idUtente, idMazzo) {
  const originale = await mazzoDellUtente(idUtente, idMazzo);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM decks WHERE user_id = $1', [idUtente]);
  if (rows[0].n >= MASSIMO_MAZZI) throw new ErroreApi(`Puoi avere al massimo ${MASSIMO_MAZZI} mazzi.`);

  const nome = (originale.name + ' (copia)').slice(0, LUNGHEZZA_MASSIMA_NOME);
  const idNuovo = await transazione(async (tx) => {
    const { rows: [mazzo] } = await tx.query(
      'INSERT INTO decks (user_id, name) VALUES ($1, $2) RETURNING id', [idUtente, nome]
    );
    await tx.query(
      `INSERT INTO deck_cards (deck_id, card_id, game_key, name, quantity, position)
       SELECT $1, card_id, game_key, name, quantity, position FROM deck_cards WHERE deck_id = $2`,
      [mazzo.id, idMazzo]
    );
    return mazzo.id;
  });
  return { success: true, deck_id: idNuovo };
}

export async function eliminaMazzo(idUtente, idMazzo) {
  await mazzoDellUtente(idUtente, idMazzo);
  await pool.query('DELETE FROM decks WHERE id = $1', [idMazzo]);
  return { success: true };
}
