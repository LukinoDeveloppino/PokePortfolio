// ════════════════════════════════════════════════════════════════════
// tcg.js — CATALOGO DELLE CARTE DA GIOCO
// ════════════════════════════════════════════════════════════════════
// Le sezioni Collezione e Mazzi non usano il catalogo CardTrader (che non
// dice se una carta è un Pokémon o un Allenatore) ma il repository GitHub
// di PokemonTCG, lo stesso da cui arrivano loghi e date dei set. Da lì:
//   • tipo di carta, simbolo di regolamento, attacchi e abilità;
//   • sigle dei set uguali a quelle di Limitless e Pokémon TCG Live
//     ("4 Dreepy TWM 128"), per importare le liste dei mazzi.
//
// La legalità in Standard la decide il simbolo di regolamento: le lettere
// ammesse sono un parametro (tcg_standard_marks) che il proprietario
// aggiorna a ogni rotazione. La "legalities" di GitHub non è affidabile.
// ════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { pool, transazione } from '../db/pool.js';
import { ErroreApi } from '../lib/errori.js';
import { formatDate } from '../lib/date.js';
import { iniziaJob, terminaJob, aggiornaContatoreJob, statoJob } from './jobs.js';
import { leggiParametro, scriviParametro } from './settings.js';
import { attendi } from './cardtrader.js';

const URL_BASE_GITHUB = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const TIMEOUT_GITHUB_MS = 30_000;
const PAUSA_FRA_SET_MS = 150;

// Si scaricano i set usciti negli ultimi anni: lo Standard copre al
// massimo 3-4 anni di espansioni. Le carte più vecchie non servono.
const ANNI_DI_CATALOGO = 5;

export const LETTERE_STANDARD_PREDEFINITE = 'H,I,J';
const PARAMETRO_LETTERE = 'tcg_standard_marks';


// ════════════════════════════════════════════════════════════════════
// NOMI E "STESSA CARTA"
// ════════════════════════════════════════════════════════════════════

// Per confrontare i nomi: minuscole, senza accenti, apostrofi uniformi,
// spazi singoli. "Pokémon Catcher" = "pokemon catcher".
export function normalizzaNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Gli Allenatori ristampati con un personaggio diverso hanno il nome fra
// parentesi ("Boss's Orders (Ghetsis)"), ma in gioco sono la stessa carta.
export function nomeDiGioco(carta) {
  const nome = String(carta.name || '').replace(/\s+/g, ' ').trim();
  return carta.supertype === 'Trainer' ? nome.replace(/\s*\([^)]*\)$/, '') : nome;
}

export function eEnergiaBase(carta) {
  return carta.supertype === 'Energy' && (carta.subtypes || []).includes('Basic');
}

// Identità di gioco di una carta:
//   • Pokémon: nome + attacchi + abilità. Due stampe con lo stesso nome
//     ma effetti diversi sono carte diverse; la versione "illustration
//     rare" di una carta resta la stessa carta.
//   • Allenatori ed Energie speciali: solo il nome.
//   • Energie base: solo il nome, con un prefisso a parte.
export function chiaveDiGioco(carta) {
  const nome = normalizzaNome(nomeDiGioco(carta));
  if (carta.supertype === 'Pokémon') {
    const effetti = JSON.stringify([
      (carta.abilities || []).map((a) => [normalizzaNome(a.name), normalizzaNome(a.text)]),
      (carta.attacks || []).map((a) => [
        normalizzaNome(a.name), (a.cost || []).join(','), String(a.damage || ''), normalizzaNome(a.text)
      ])
    ]);
    return `P|${nome}|${createHash('sha1').update(effetti).digest('hex').slice(0, 12)}`;
  }
  if (eEnergiaBase(carta)) return `B|${nome}`;
  return `${carta.supertype === 'Trainer' ? 'T' : 'E'}|${nome}`;
}

export const eChiaveEnergiaBase = (chiave) => String(chiave).startsWith('B|');

// Trasforma le carte di un set GitHub nelle righe di tcg_cards.
export function convertiCarteGithub(idSet, carte) {
  return (Array.isArray(carte) ? carte : [])
    .filter((c) => c && c.id && ['Pokémon', 'Trainer', 'Energy'].includes(c.supertype))
    .map((c) => ({
      id:              c.id,
      set_id:          idSet,
      number:          String(c.number || ''),
      name:            nomeDiGioco(c),
      supertype:       c.supertype,
      subtypes:        Array.isArray(c.subtypes) ? c.subtypes : [],
      regulation_mark: c.regulationMark || null,
      game_key:        chiaveDiGioco(c),
      rarity:          c.rarity || null,
      image_small:     c.images?.small || null,
      image_large:     c.images?.large || null
    }));
}


// ════════════════════════════════════════════════════════════════════
// FORMATO STANDARD (lettere di regolamento ammesse)
// ════════════════════════════════════════════════════════════════════

export async function leggiLettereStandard() {
  const valore = (await leggiParametro(PARAMETRO_LETTERE)) || LETTERE_STANDARD_PREDEFINITE;
  return valore.split(',').map((l) => l.trim().toUpperCase()).filter(Boolean);
}

export async function impostaLettereStandard(testo) {
  const lettere = [...new Set(String(testo || '').toUpperCase().split(/[\s,;]+/).filter(Boolean))].sort();
  if (!lettere.length || lettere.length > 10 || lettere.some((l) => !/^[A-Z]$/.test(l))) {
    throw new ErroreApi('Indica le lettere di regolamento ammesse separate da virgole, es. "H, I, J".');
  }
  await scriviParametro(PARAMETRO_LETTERE, lettere.join(','));
  return lettere;
}

// Una carta è legale se è un'Energia base o se il suo simbolo è ammesso.
export function cartaLegale(carta, lettere) {
  return eChiaveEnergiaBase(carta.game_key) || (!!carta.regulation_mark && lettere.includes(carta.regulation_mark));
}

// Il proprietario è chi ha installato l'app: il primo utente registrato.
export async function eProprietario(idUtente) {
  const { rows } = await pool.query('SELECT min(id) AS id FROM users');
  return rows[0].id !== null && Number(rows[0].id) === Number(idUtente);
}


// ════════════════════════════════════════════════════════════════════
// DOWNLOAD DA GITHUB
// ════════════════════════════════════════════════════════════════════

async function scaricaJson(percorso) {
  const risposta = await fetch(URL_BASE_GITHUB + percorso, { signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS) });
  if (!risposta.ok) throw new Error(`GitHub ${percorso}: HTTP ${risposta.status}`);
  return risposta.json();
}

// 'yyyy/MM/dd' → 'yyyy-MM-dd'
const dataGithub = (data) => (data ? String(data).replace(/\//g, '-') : null);

export function setDaScaricare(setGithub, oggi = new Date()) {
  const limite = new Date(oggi);
  limite.setFullYear(limite.getFullYear() - ANNI_DI_CATALOGO);
  const dataLimite = limite.toISOString().slice(0, 10);
  return (Array.isArray(setGithub) ? setGithub : [])
    .filter((s) => s && s.id && dataGithub(s.releaseDate) && dataGithub(s.releaseDate) >= dataLimite);
}

async function salvaSetTcg(set, carte) {
  await transazione(async (tx) => {
    await tx.query(
      `INSERT INTO tcg_sets (id, name, code, release_date) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, code = EXCLUDED.code,
         release_date = EXCLUDED.release_date, updated_at = now()`,
      [set.id, set.name, set.ptcgoCode || null, dataGithub(set.releaseDate)]
    );
    await tx.query('DELETE FROM tcg_cards WHERE set_id = $1', [set.id]);
    if (!carte.length) return;
    await tx.query(
      `INSERT INTO tcg_cards (id, set_id, number, name, supertype, subtypes, regulation_mark,
                              game_key, rarity, image_small, image_large)
       SELECT id, set_id, number, name, supertype,
              ARRAY(SELECT json_array_elements_text(subtypes::json)),
              regulation_mark, game_key, rarity, image_small, image_large
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                     $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
           AS t(id, set_id, number, name, supertype, subtypes, regulation_mark,
                game_key, rarity, image_small, image_large)
       ON CONFLICT (id) DO NOTHING`,
      [
        carte.map((c) => c.id),
        carte.map((c) => c.set_id),
        carte.map((c) => c.number),
        carte.map((c) => c.name),
        carte.map((c) => c.supertype),
        carte.map((c) => JSON.stringify(c.subtypes)),
        carte.map((c) => c.regulation_mark),
        carte.map((c) => c.game_key),
        carte.map((c) => c.rarity),
        carte.map((c) => c.image_small),
        carte.map((c) => c.image_large)
      ]
    );
  });
}

async function eseguiSyncTcg(idEsecuzione, log) {
  const daScaricare = setDaScaricare(await scaricaJson('/sets/en.json'));
  log.info(`[TCG] Set da scaricare: ${daScaricare.length}`);

  let setScritti = 0;
  for (const set of daScaricare) {
    try {
      const carte = convertiCarteGithub(set.id, await scaricaJson(`/cards/en/${encodeURIComponent(set.id)}.json`));
      await salvaSetTcg(set, carte);
      setScritti++;
      await aggiornaContatoreJob(idEsecuzione, setScritti);
    } catch (errore) {
      // Un set che non si scarica non deve fermare tutto il giro.
      log.warn(`[TCG] ${set.name}: ${errore.message}, lo salto.`);
    }
    await attendi(PAUSA_FRA_SET_MS);
  }
  if (!setScritti && daScaricare.length) throw new Error('Nessun set scaricato da GitHub.');
  return setScritti;
}

// Stessa forma di avviaSyncCatalogo: { avviato: false } se è già in
// corso, altrimenti { avviato: true, completata }.
export async function avviaSyncTcg({ log = console } = {}) {
  const idEsecuzione = await iniziaJob('tcg_sync');
  if (!idEsecuzione) return { avviato: false };

  const completata = eseguiSyncTcg(idEsecuzione, log)
    .then(async (contatore) => {
      await terminaJob(idEsecuzione, { contatore });
      log.info(`[TCG] Completata: ${contatore} set scritti.`);
      return contatore;
    })
    .catch(async (errore) => {
      log.error(`[TCG] Errore: ${errore.message}`);
      await terminaJob(idEsecuzione, { errore: errore.message }).catch(() => {});
      throw errore;
    });

  completata.catch(() => {});
  return { avviato: true, completata };
}

export async function catalogoTcgVuoto() {
  const { rows } = await pool.query('SELECT NOT EXISTS (SELECT 1 FROM tcg_cards) AS vuoto');
  return rows[0].vuoto;
}

// Stato per l'intestazione delle sezioni Collezione e Mazzi.
export async function getStatoTcg(idUtente) {
  const [{ rows }, stato, lettere, proprietario] = await Promise.all([
    pool.query('SELECT count(*)::int AS carte FROM tcg_cards'),
    statoJob('tcg_sync'),
    leggiLettereStandard(),
    eProprietario(idUtente)
  ]);
  return {
    success:        true,
    cards_count:    rows[0].carte,
    sync_running:   stato.running,
    last_sync:      formatDate(stato.lastDone),
    standard_marks: lettere,
    is_owner:       proprietario
  };
}


// ════════════════════════════════════════════════════════════════════
// LETTURA: GRUPPI DI STAMPE CON LA STESSA game_key
// ════════════════════════════════════════════════════════════════════

const COLONNE_CARTA_TCG = `c.id, c.set_id, c.number, c.name, c.supertype, c.subtypes, c.regulation_mark,
                           c.game_key, c.rarity, c.image_small, c.image_large,
                           s.code AS set_code, s.name AS set_name, s.release_date`;

const ORDINE_RARITA = ['common', 'uncommon', 'rare', 'double rare', 'promo'];
const rangoRarita = (rarita) => {
  const i = ORDINE_RARITA.indexOf(String(rarita || '').toLowerCase());
  return i === -1 ? ORDINE_RARITA.length : i;
};

// Stampa da mostrare per una carta: una legale, la meno rara (l'immagine
// "normale"), la più recente.
function confrontaStampe(lettere) {
  return (a, b) =>
    (cartaLegale(b, lettere) - cartaLegale(a, lettere)) ||
    (rangoRarita(a.rarity) - rangoRarita(b.rarity)) ||
    String(b.release_date || '').localeCompare(String(a.release_date || '')) ||
    a.id.localeCompare(b.id);
}

function convertiStampa(riga, lettere) {
  return {
    card_id:   riga.id,
    set_code:  riga.set_code || '',
    set_name:  riga.set_name || '',
    number:    riga.number,
    rarity:    riga.rarity || '',
    mark:      riga.regulation_mark || '',
    legal:     cartaLegale(riga, lettere),
    image_small: riga.image_small || '',
    image_large: riga.image_large || ''
  };
}

// Righe di tcg_cards → mappa game_key → gruppo { name, supertype, ... }.
export function raggruppaPerChiave(righe, lettere) {
  const perChiave = new Map();
  for (const riga of righe) {
    if (!perChiave.has(riga.game_key)) perChiave.set(riga.game_key, []);
    perChiave.get(riga.game_key).push(riga);
  }
  const gruppi = new Map();
  for (const [chiave, stampe] of perChiave) {
    stampe.sort(confrontaStampe(lettere));
    const prima = stampe[0];
    gruppi.set(chiave, {
      game_key:     chiave,
      name:         prima.name,
      supertype:    prima.supertype,
      subtypes:     prima.subtypes || [],
      basic_energy: eChiaveEnergiaBase(chiave),
      legal:        stampe.some((s) => cartaLegale(s, lettere)),
      card_id:      prima.id,
      image_small:  prima.image_small || '',
      image_large:  prima.image_large || '',
      prints:       stampe.map((s) => convertiStampa(s, lettere))
    });
  }
  return gruppi;
}

export async function leggiGruppi(chiavi, lettere) {
  if (!chiavi.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA_TCG} FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id
      WHERE c.game_key = ANY($1::text[])`,
    [[...new Set(chiavi)]]
  );
  return raggruppaPerChiave(rows, lettere);
}

const LIMITE_GRUPPI_RICERCA = 60;

// Lato SQL di normalizzaNome per i caratteri che compaiono davvero nei
// nomi delle carte (accenti di "Pokémon", apostrofo tipografico).
const NOME_CONFRONTABILE = `translate(lower(name), 'éèáíóú’', 'eeaiou''')`;

// Ricerca per nome (anche parziale). Restituisce un gruppo per carta di
// gioco, con tutte le sue stampe. `soloLegali` esclude le carte ruotate,
// `senzaEnergieBase` le Energie base (che nella collezione non servono).
export async function cercaCarte(testo, { soloLegali = false, senzaEnergieBase = false } = {}) {
  const query = normalizzaNome(testo);
  if (query.length < 2) return { success: true, cards: [] };

  const lettere = await leggiLettereStandard();
  const letterale = query.replace(/[\\%_]/g, (c) => '\\' + c);
  const { rows: chiavi } = await pool.query(
    `SELECT game_key FROM tcg_cards
      WHERE ${NOME_CONFRONTABILE} LIKE $1
      GROUP BY game_key
      ORDER BY bool_or(${NOME_CONFRONTABILE} LIKE $2) DESC, min(name)
      LIMIT 400`,
    ['%' + letterale + '%', letterale + '%']
  );
  const gruppi = [...(await leggiGruppi(chiavi.map((r) => r.game_key), lettere)).values()]
    .filter((g) => (!soloLegali || g.legal) && (!senzaEnergieBase || !g.basic_energy));

  // Prima chi inizia con il testo cercato, poi in ordine alfabetico.
  gruppi.sort((a, b) =>
    (normalizzaNome(b.name).startsWith(query) - normalizzaNome(a.name).startsWith(query)) ||
    a.name.localeCompare(b.name) || a.game_key.localeCompare(b.game_key));
  return { success: true, cards: gruppi.slice(0, LIMITE_GRUPPI_RICERCA) };
}


// ════════════════════════════════════════════════════════════════════
// IMPORT DELLE LISTE (formato Limitless / Pokémon TCG Live)
// ════════════════════════════════════════════════════════════════════
//   Pokémon: 12
//   4 Dreepy TWM 128
//   Trainer: 36
//   4 Boss's Orders PAL 172
//   Energy: 12
//   7 Basic {D} Energy SVE 7

const INTESTAZIONE = /^(pok[eé]mon|trainers?|allenatori|energy|energie|energia|total cards|totale)\b[^:]*:\s*\d*\s*$/i;
const RIGA_CON_SET = /^(\d{1,2})\s*x?\s+(.+?)\s+([A-Za-z0-9][A-Za-z0-9-]{1,7})\s+([A-Za-z]{0,4}\d{1,4}[a-z]?)$/;
const RIGA_SOLO_NOME = /^(\d{1,2})\s*x?\s+(.+)$/;

// Sigle usate da Limitless/PTCGL diverse da quelle di GitHub.
const SIGLE_EQUIVALENTI = { SVP: 'PR-SV', 'PR-SV': 'PR-SV' };

const SIMBOLI_ENERGIA = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal'
};

// "Basic {D} Energy", "Darkness Energy", "{D} Energy" → "Basic Darkness Energy"
export function nomeEnergiaBase(nome) {
  const testo = String(nome || '').trim();
  const simbolo = testo.match(/^(?:basic\s+)?\{([GRWLPFDM])\}\s+energy$/i);
  if (simbolo) return `Basic ${SIMBOLI_ENERGIA[simbolo[1].toUpperCase()]} Energy`;
  const tipo = testo.match(/^(?:basic\s+)?(grass|fire|water|lightning|psychic|fighting|darkness|metal)\s+energy$/i);
  if (tipo) return `Basic ${tipo[1][0].toUpperCase()}${tipo[1].slice(1).toLowerCase()} Energy`;
  return null;
}

// Testo incollato → righe { quantita, nome, sigla, numero, testo }.
// Intestazioni e righe vuote si saltano; il resto che non si capisce
// finisce in `nonCapite`.
export function leggiListaMazzo(testo) {
  const righe = [];
  const nonCapite = [];
  for (const grezza of String(testo || '').split(/\r?\n/)) {
    const riga = grezza.replace(/^[\s*•\-–]+/, '').replace(/\s+/g, ' ').trim();
    if (!riga || INTESTAZIONE.test(riga)) continue;

    const conSet = riga.match(RIGA_CON_SET);
    const soloNome = riga.match(RIGA_SOLO_NOME);
    if (!soloNome) { nonCapite.push(riga); continue; }

    const quantita = parseInt(soloNome[1], 10);
    if (!quantita) { nonCapite.push(riga); continue; }
    righe.push(conSet
      ? { quantita, nome: conSet[2], sigla: conSet[3].toUpperCase(), numero: conSet[4], testo: riga, nomeCompleto: soloNome[2] }
      : { quantita, nome: soloNome[2], sigla: null, numero: null, testo: riga, nomeCompleto: soloNome[2] });
  }
  return { righe, nonCapite };
}

const senzaZeri = (numero) => String(numero || '').replace(/^0+(?=.)/, '').toUpperCase();

async function cercaPerSiglaENumero(sigla, numero) {
  const codice = SIGLE_EQUIVALENTI[sigla] || sigla;
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.game_key FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id
      WHERE upper(s.code) = $1 AND upper(ltrim(c.number, '0')) = $2
      ORDER BY s.release_date DESC NULLS LAST, c.id`,
    [codice, senzaZeri(numero)]
  );
  return rows;
}

// Per nome: se più carte di gioco hanno quel nome (Pokémon con attacchi
// diversi) prende quella con la stampa legale più recente e lo segnala.
async function cercaPerNome(nome, lettere) {
  const nomeEnergia = nomeEnergiaBase(nome);
  const cercato = normalizzaNome(nomeEnergia || nome);
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA_TCG} FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id
      WHERE ${NOME_CONFRONTABILE.replace('name', 'c.name')} = $1`,
    [cercato]
  );
  if (!rows.length) return null;
  const gruppi = [...raggruppaPerChiave(rows, lettere).values()];
  const ordinati = rows.slice().sort(confrontaStampe(lettere));
  const scelta = ordinati[0];
  return { id: scelta.id, name: scelta.name, game_key: scelta.game_key, ambigua: gruppi.length > 1 };
}

// Righe lette → carte del mazzo. Le righe con la stessa stampa si sommano.
export async function risolviListaMazzo(testo) {
  const { righe, nonCapite } = leggiListaMazzo(testo);
  const lettere = await leggiLettereStandard();
  const carte = new Map();
  const nonRiconosciute = [...nonCapite];
  const daControllare = [];

  for (const riga of righe) {
    let trovata = null;
    if (riga.sigla) {
      const candidati = await cercaPerSiglaENumero(riga.sigla, riga.numero);
      // Con la sigla condivisa (set + Trainer Gallery) il nome decide.
      trovata = candidati.find((c) => normalizzaNome(c.name) === normalizzaNome(riga.nome)) || candidati[0] || null;
    }
    if (!trovata) {
      trovata = await cercaPerNome(riga.sigla ? riga.nome : riga.nomeCompleto, lettere)
             || (riga.sigla ? await cercaPerNome(riga.nomeCompleto, lettere) : null);
      if (trovata && trovata.ambigua) daControllare.push(riga.testo);
    }
    if (!trovata) { nonRiconosciute.push(riga.testo); continue; }

    const esistente = carte.get(trovata.id);
    if (esistente) esistente.quantity = Math.min(60, esistente.quantity + riga.quantita);
    else carte.set(trovata.id, { card_id: trovata.id, game_key: trovata.game_key, name: trovata.name, quantity: Math.min(60, riga.quantita) });
  }
  return { carte: [...carte.values()], nonRiconosciute, daControllare };
}

// Una singola carta per id (aggiunta a mano a collezione o mazzo).
export async function leggiCarta(idCarta) {
  const { rows } = await pool.query(
    `SELECT ${COLONNE_CARTA_TCG} FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id WHERE c.id = $1`,
    [String(idCarta || '')]
  );
  return rows[0] || null;
}
