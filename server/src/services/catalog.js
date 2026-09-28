// ════════════════════════════════════════════════════════════════════
// catalog.js — CATALOGO CARTE (sync da CardTrader e lettura)
// ════════════════════════════════════════════════════════════════════
// Porting di Script/Cards.js. Senza il limite dei 6 minuti di Apps
// Script la sync è un unico ciclo sui set: niente cursori né trigger che
// si riprogrammano. Ogni set viene salvato in una transazione.
//
// Modalità della sync:
//   'sync'    scarica solo i set non ancora in catalogo (trigger giornaliero)
//   'refresh' ricontrolla tutti i set e riscrive solo quelli cambiati
//             (tasto "Aggiorna tutti i set")
// ════════════════════════════════════════════════════════════════════

import { pool, transazione } from '../db/pool.js';
import {
  chiamaCardTrader, attendi, ID_GIOCO_POKEMON, ID_CATEGORIA_CARTA_SINGOLA
} from './cardtrader.js';
import { ID_ESPANSIONI_ESCLUSE } from './espansioni-escluse.js';
import { tokenCardTraderDiDefault } from './settings.js';
import { iniziaJob, terminaJob, aggiornaContatoreJob, statoJob } from './jobs.js';
import { formatDate } from '../lib/date.js';
import { ErroreApi } from '../lib/errori.js';

// Pausa fra un set e l'altro per non stressare l'API CardTrader.
const PAUSA_FRA_SET_MS = 200;


// ════════════════════════════════════════════════════════════════════
// LOGHI E DATE DEI SET (dal repository GitHub di PokemonTCG)
// ════════════════════════════════════════════════════════════════════

const URL_SET_GITHUB = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';
const DURATA_CACHE_GITHUB_MS = 6 * 60 * 60 * 1000;
let cacheGithub = { mappa: null, scadenza: 0 };

// nome set in minuscolo → { logo, releaseDate 'yyyy-MM-dd' }. In caso di
// errore restituisce una mappa vuota: logo e data sono solo decorativi.
export async function mappaSetGithub() {
  if (cacheGithub.mappa && Date.now() < cacheGithub.scadenza) return cacheGithub.mappa;
  try {
    const risposta = await fetch(URL_SET_GITHUB, { signal: AbortSignal.timeout(30_000) });
    if (!risposta.ok) return {};
    const mappa = {};
    for (const set of await risposta.json()) {
      mappa[set.name.toLowerCase()] = {
        logo:        set.images?.logo || '',
        // GitHub usa 'yyyy/MM/dd'.
        releaseDate: (set.releaseDate || '').replaceAll('/', '-')
      };
    }
    cacheGithub = { mappa, scadenza: Date.now() + DURATA_CACHE_GITHUB_MS };
    return mappa;
  } catch {
    return {};
  }
}


// ════════════════════════════════════════════════════════════════════
// DOWNLOAD DI UN SINGOLO SET
// ════════════════════════════════════════════════════════════════════

// Scarica i blueprint dell'espansione e li trasforma in { set, carte },
// oppure { skip: motivo } se il set non contiene carte singole.
export async function scaricaDatiSet(espansione, apiKey, setGithub) {
  const blueprint = await chiamaCardTrader(`/blueprints/export?expansion_id=${espansione.id}`, apiKey);
  if (!Array.isArray(blueprint)) return { skip: 'risposta non valida' };
  return convertiBlueprintInSet(espansione, blueprint, setGithub);
}

// Parte pura della conversione, separata per poterla testare.
export function convertiBlueprintInSet(espansione, blueprint, setGithub = {}) {
  const carteSingole = blueprint.filter((bp) => bp.category_id === ID_CATEGORIA_CARTA_SINGOLA);
  if (carteSingole.length === 0) return { skip: 'nessuna carta singola' };

  // JP o INT? Lo dice la lingua di default della prima carta.
  const proprietaLingua = (carteSingole[0].editable_properties || [])
    .find((p) => p.name === 'pokemon_language');
  const serie = proprietaLingua && proprietaLingua.default_value === 'jp' ? 'JP' : 'INT';

  // Logo e data di uscita da GitHub, disponibili solo per i set INT.
  const datiGithub = serie === 'INT' ? setGithub[espansione.name.toLowerCase()] : null;

  const set = {
    id:           espansione.id,
    name:         espansione.name,
    series:       serie,
    logo_url:     datiGithub?.logo || null,
    release_date: datiGithub?.releaseDate || null,
    total_cards:  carteSingole.length
  };

  const carte = carteSingole.map((bp) => {
    const numero = bp.fixed_properties?.collector_number || '';
    const rarita = bp.fixed_properties?.pokemon_rarity || '';
    const variante = (bp.version || '').split('|')[0].trim();
    const raritaDaMostrare = (variante && variante.toLowerCase() !== rarita.toLowerCase())
      ? (rarita ? `${rarita} · ${variante}` : variante)
      : rarita;

    return {
      id:           `${espansione.id}_${bp.id}`,
      blueprint_id: bp.id,
      set_id:       espansione.id,
      name:         bp.name,
      number:       String(numero),
      rarity:       raritaDaMostrare,
      image_url:    bp.image_url || ''
    };
  });

  return { set, carte };
}


// ════════════════════════════════════════════════════════════════════
// SALVATAGGIO DI UN SET
// ════════════════════════════════════════════════════════════════════

// "Firma" delle carte di un set: id + URL immagine, ordinati. Sono i campi
// che cambiano quando un set uscito da poco viene completato.
function firmaCarte(carte) {
  return carte.map((c) => `${c.id}|${c.image_url || ''}`).sort().join('\n');
}

// Salva set e carte in una transazione. Le carte vengono riscritte solo se
// la firma è cambiata. Restituisce { carteCambiate, carteRimosse }.
export async function salvaSet({ set, carte }) {
  return transazione(async (tx) => {
    // Se GitHub non ha logo o data, tengo quelli già salvati.
    await tx.query(
      `INSERT INTO sets (id, name, series, logo_url, release_date, total_cards, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name         = EXCLUDED.name,
         series       = EXCLUDED.series,
         logo_url     = COALESCE(EXCLUDED.logo_url, sets.logo_url),
         release_date = COALESCE(EXCLUDED.release_date, sets.release_date),
         total_cards  = EXCLUDED.total_cards,
         updated_at   = now()`,
      [set.id, set.name, set.series, set.logo_url, set.release_date, set.total_cards]
    );

    const { rows: esistenti } = await tx.query(
      'SELECT id, image_url FROM cards WHERE set_id = $1', [set.id]
    );
    if (esistenti.length && firmaCarte(esistenti) === firmaCarte(carte)) {
      return { carteCambiate: false, carteRimosse: esistenti.length };
    }

    await tx.query('DELETE FROM cards WHERE set_id = $1', [set.id]);
    await tx.query(
      `INSERT INTO cards (id, blueprint_id, set_id, name, number, rarity, image_url)
       SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[])`,
      [
        carte.map((c) => c.id),
        carte.map((c) => c.blueprint_id),
        carte.map((c) => c.set_id),
        carte.map((c) => c.name),
        carte.map((c) => c.number),
        carte.map((c) => c.rarity),
        carte.map((c) => c.image_url)
      ]
    );
    return { carteCambiate: true, carteRimosse: esistenti.length };
  });
}


// ════════════════════════════════════════════════════════════════════
// SYNC DEL CATALOGO
// ════════════════════════════════════════════════════════════════════

// Avvia la sync. Restituisce { avviato: false } se ce n'è già una in
// corso, altrimenti { avviato: true, completata } dove `completata` è la
// promise del lavoro: la CLI la attende, le rotte HTTP no.
export async function avviaSyncCatalogo({ mode = 'sync', log = console } = {}) {
  const idEsecuzione = await iniziaJob('catalog_sync', mode);
  if (!idEsecuzione) return { avviato: false };

  const completata = eseguiSync(idEsecuzione, mode, log)
    .then(async (contatore) => {
      await terminaJob(idEsecuzione, { contatore });
      log.info(`[SYNC] Completata (${mode}): ${contatore} set scritti.`);
      return contatore;
    })
    .catch(async (errore) => {
      log.error(`[SYNC] Errore: ${errore.message}`);
      await terminaJob(idEsecuzione, { errore: errore.message }).catch(() => {});
      throw errore;
    });

  // Nessuno è obbligato ad attenderla: l'errore è già registrato in job_runs.
  completata.catch(() => {});
  return { avviato: true, completata };
}

async function eseguiSync(idEsecuzione, mode, log) {
  const apiKey = await tokenCardTraderDiDefault();
  if (!apiKey) throw new Error('Nessuna API key CardTrader configurata (CARDTRADER_DEFAULT_TOKEN).');

  const espansioni = (await chiamaCardTrader('/expansions', apiKey))
    .filter((e) => e.game_id === ID_GIOCO_POKEMON && !ID_ESPANSIONI_ESCLUSE.has(e.id));
  log.info(`[SYNC] Set da controllare: ${espansioni.length} (${mode})`);

  const { rows } = await pool.query('SELECT id FROM sets');
  const setInCatalogo = new Set(rows.map((r) => r.id));
  const setGithub = await mappaSetGithub();

  let setScritti = 0;
  for (const espansione of espansioni) {
    if (mode === 'sync' && setInCatalogo.has(espansione.id)) continue;

    let dati;
    try {
      dati = await scaricaDatiSet(espansione, apiKey, setGithub);
    } catch (errore) {
      // Un set che non si scarica non deve fermare tutto il giro.
      log.warn(`[SYNC] ${espansione.name}: ${errore.message}, lo salto.`);
      continue;
    }
    if (dati.skip) continue;

    const esito = await salvaSet(dati);
    if (esito.carteCambiate) {
      setScritti++;
      await aggiornaContatoreJob(idEsecuzione, setScritti);
      log.info(`[SYNC] ${espansione.name}: ${esito.carteRimosse} → ${dati.carte.length} carte`);
    }
    await attendi(PAUSA_FRA_SET_MS);
  }
  return setScritti;
}


// ════════════════════════════════════════════════════════════════════
// REFRESH MANUALE DI UN SET (tasto ⟳)
// ════════════════════════════════════════════════════════════════════

export async function refreshSet(idSet) {
  const id = Number(idSet);
  const { rows } = await pool.query('SELECT id, name FROM sets WHERE id = $1', [id]);
  if (!rows.length) throw new ErroreApi('Set non trovato nel catalogo.');

  const apiKey = await tokenCardTraderDiDefault();
  if (!apiKey) throw new ErroreApi('Nessuna API key CardTrader configurata.');

  const dati = await scaricaDatiSet(rows[0], apiKey, await mappaSetGithub());
  if (dati.skip) throw new ErroreApi('CardTrader: ' + dati.skip);

  const esito = await salvaSet(dati);
  const set = await leggiSet(id);
  return { success: true, cards_before: esito.carteRimosse, set };
}


// ════════════════════════════════════════════════════════════════════
// LETTURA DEL CATALOGO (forma delle risposte identica alla versione GAS)
// ════════════════════════════════════════════════════════════════════

const COLONNE_SET = 'id, name, series, logo_url, release_date, total_cards';

function convertiSet(riga) {
  return {
    set_id:          String(riga.id),
    set_name:        riga.name,
    set_series:      riga.series,
    set_logo_url:    riga.logo_url || '',
    release_date:    riga.release_date || '',
    total_cards:     riga.total_cards,
    ct_expansion_id: riga.id
  };
}

const COLONNE_CARTA = `c.id, c.name, c.set_id, s.name AS set_name, s.series AS set_series,
                       c.number, c.rarity, c.image_url, c.blueprint_id`;

function convertiCarta(riga) {
  return {
    id:              riga.id,
    name:            riga.name,
    set_id:          String(riga.set_id),
    set_name:        riga.set_name,
    set_series:      riga.set_series,
    number:          riga.number || '',
    rarity:          riga.rarity || '',
    types:           '',
    image_url_small: riga.image_url || '',
    image_url_large: riga.image_url || '',
    set_logo_url:    '',
    blueprint_id:    riga.blueprint_id,
    is_jp:           riga.set_series === 'JP'
  };
}

async function leggiSet(id) {
  const { rows } = await pool.query(`SELECT ${COLONNE_SET} FROM sets WHERE id = $1`, [id]);
  return rows.length ? convertiSet(rows[0]) : null;
}

export async function leggiSetNascosti(idUtente) {
  const { rows } = await pool.query('SELECT set_id FROM hidden_sets WHERE user_id = $1', [idUtente]);
  return rows.map((r) => String(r.set_id));
}

export async function getSetList(idUtente) {
  const [{ rows }, stato, nascosti] = await Promise.all([
    pool.query(`SELECT ${COLONNE_SET} FROM sets ORDER BY id`),
    statoJob('catalog_sync'),
    leggiSetNascosti(idUtente)
  ]);
  const sets = rows.map(convertiSet);
  return {
    success:        true,
    sets,
    empty:          sets.length === 0,
    last_sync:      formatDate(stato.lastDone),
    sync_running:   stato.running,
    sync_mode:      stato.mode,
    hidden_set_ids: nascosti
  };
}

export async function getCatalogSyncStatus() {
  const stato = await statoJob('catalog_sync');
  return {
    success:         true,
    running:         stato.running,
    mode:            stato.mode,
    refresh_changed: stato.refreshChanged,
    last_sync:       formatDate(stato.lastDone)
  };
}

export async function setSetHidden(idUtente, idSet, nascondi) {
  const id = Number(idSet);
  if (!Number.isInteger(id)) throw new ErroreApi('Set non valido.');
  if (nascondi) {
    await pool.query(
      'INSERT INTO hidden_sets (user_id, set_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [idUtente, id]
    );
  } else {
    await pool.query('DELETE FROM hidden_sets WHERE user_id = $1 AND set_id = $2', [idUtente, id]);
  }
  return { success: true, hidden_set_ids: await leggiSetNascosti(idUtente) };
}

export async function getCardsForSet(idSet) {
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA} FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.set_id = $1`,
    [Number(idSet)]
  );
  return { success: true, cards: rows.map(convertiCarta) };
}

export async function getCardsForIds(idCarte) {
  if (!Array.isArray(idCarte) || idCarte.length === 0) return { success: true, cards: [] };
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA} FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ANY($1::text[])`,
    [idCarte.map(String)]
  );
  return { success: true, cards: rows.map(convertiCarta) };
}

const LIMITE_RISULTATI_RICERCA = 500;

export async function searchCards(testo) {
  const query = String(testo || '').trim().toLowerCase();
  if (query.length < 2) return { success: true, cards: [] };

  // % e _ sono jolly di LIKE: li rendo letterali.
  const modello = '%' + query.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA} FROM cards c JOIN sets s ON s.id = c.set_id
      WHERE lower(c.name) LIKE $1 LIMIT ${LIMITE_RISULTATI_RICERCA}`,
    [modello]
  );
  return { success: true, cards: rows.map(convertiCarta) };
}
