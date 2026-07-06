// ════════════════════════════════════════════════════════════════════
// Prices.gs — PREZZI DA CARDTRADER + DASHBOARD + BATCH NOTTURNO
// ════════════════════════════════════════════════════════════════════
// Gestisce:
//   1. Prezzo minimo su CardTrader per una variante (carta+condiz+lingua+finitura)
//   2. Chiamata real-time dal frontend (apertura modal carta)
//   3. Trigger batch multi-hop che aggiorna i prezzi di tutti gli utenti
//   4. Dati per la dashboard (valore totale, n. carte, n. set)
//
// URL base API (URL_BASE_API_CARDTRADER) definito in Cards.gs.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// CONVERSIONI: valori app → codici CardTrader
// ════════════════════════════════════════════════════════════════════

function convertiCondizionePerCardTrader(condizione) {
  var mappa = {
    'Near Mint':         'Near Mint',
    'Lightly Played':    'Slightly Played',
    'Moderately Played': 'Moderately Played',
    'Heavily Played':    'Heavily Played',
    'Damaged':           'Poor'
  };
  return mappa[condizione] || condizione;
}

function convertiLinguaPerCardTrader(lingua) {
  var mappa = {
    'ITA': 'it', 'ENG': 'en', 'JPN': 'jp', 'DEU': 'de',
    'FRA': 'fr', 'ESP': 'es', 'KOR': 'kr', 'POR': 'pt'
  };
  return mappa[lingua] || 'en';
}


// ════════════════════════════════════════════════════════════════════
// RECUPERO DEL blueprint_id
// ════════════════════════════════════════════════════════════════════

// Logica di scansione condivisa tra le due varianti pubbliche.
function _cercaBlueprintIdInFoglio(foglio, cardId) {
  if (!foglio) return null;
  var ultimaRiga = foglio.getLastRow();
  if (ultimaRiga <= 1) return null;
  var righe = foglio.getRange(1, 1, ultimaRiga, 13).getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(cardId)) {
      return righe[i][12] ? Number(righe[i][12]) : null;
    }
  }
  return null;
}

// Cerca il blueprint_id per una carta nella cache della sessione corrente.
function getBlueprintIdForCard(cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);
  return _cercaBlueprintIdInFoglio(getSheet('CACHE_CARDS'), cardId);
}

// Come sopra, ma su uno spreadsheet arbitrario (usato dal batch multi-utente).
function getBlueprintIdFromSheet(spreadsheet, cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);
  try {
    return _cercaBlueprintIdInFoglio(spreadsheet.getSheetByName('CACHE_CARDS'), cardId);
  } catch (e) {
    Logger.log('[PRICES] getBlueprintIdFromSheet error: ' + e.message);
    return null;
  }
}


// ════════════════════════════════════════════════════════════════════
// CORE: PREZZO MINIMO DA CARDTRADER PER UNA VARIANTE
// ════════════════════════════════════════════════════════════════════

function _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };

  var idBlueprint = blueprintId ? Number(blueprintId) : null;
  if (!idBlueprint) {
    Logger.log('[PRICES] Nessun blueprint_id per ' + cardId);
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  Logger.log('[PRICES] blueprint_id=' + idBlueprint + ' | ' + condizione + ' | ' + lingua);

  var linguaCardTrader = convertiLinguaPerCardTrader(lingua);
  var url = URL_BASE_API_CARDTRADER + '/marketplace/products' +
            '?blueprint_id=' + idBlueprint +
            '&language=' + linguaCardTrader;

  if (finitura === 'Holofoil' || finitura === 'Special') url += '&foil=true';

  var risposta = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var codiceHttp = risposta.getResponseCode();
  Logger.log('[PRICES] HTTP ' + codiceHttp + ' → ' + url);

  if (codiceHttp !== 200) {
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }

  var prodottiInVendita = (JSON.parse(risposta.getContentText()))[String(idBlueprint)] || [];
  Logger.log('[PRICES] Prodotti trovati: ' + prodottiInVendita.length);

  if (prodottiInVendita.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  var condizioneCardTrader = convertiCondizionePerCardTrader(condizione);

  // Filtra per condizione; se nessuno corrisponde, accetta qualsiasi condizione.
  var prodottiFiltrati = prodottiInVendita.filter(function(p) {
    return !p.on_vacation &&
           (!p.properties_hash || !p.properties_hash.condition ||
            p.properties_hash.condition === condizioneCardTrader);
  });

  if (prodottiFiltrati.length === 0) {
    prodottiFiltrati = prodottiInVendita.filter(function(p) { return !p.on_vacation; });
  }
  if (prodottiFiltrati.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  // Trova il prezzo minimo (prezzi in centesimi).
  var prezzoMinimoInCentesimi = null;
  var valuta = 'EUR';

  prodottiFiltrati.forEach(function(p) {
    if (p.price && typeof p.price.cents === 'number') {
      if (prezzoMinimoInCentesimi === null || p.price.cents < prezzoMinimoInCentesimi) {
        prezzoMinimoInCentesimi = p.price.cents;
        valuta = p.price.currency || 'EUR';
      }
    }
  });

  if (prezzoMinimoInCentesimi === null) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  var prezzoInEuro = parseFloat((prezzoMinimoInCentesimi / 100).toFixed(2));
  Logger.log('[PRICES] Prezzo: ' + prezzoInEuro + ' ' + valuta);

  return { success: true, price: prezzoInEuro, currency: valuta, message: null };
}


// ════════════════════════════════════════════════════════════════════
// CORE: PREZZO MINIMO PER UN PRODOTTO SIGILLATO
// ════════════════════════════════════════════════════════════════════
// Diverso dalle carte: un sigillato NON ha condizione né finitura (foil),
// quindi non si filtra su quelle. La lingua invece conta (una booster box
// ENG e una JPN hanno prezzi molto diversi): la si passa come filtro, ma
// se CardTrader per quel prodotto non espone la proprietà lingua il filtro
// restituirebbe zero risultati → in quel caso si riprova senza lingua.

// Estrae il prezzo minimo in € da un URL /marketplace/products, scartando
// i venditori in ferie. Restituisce { prezzo, valuta } (prezzo null se
// nessun prodotto valido) oppure null se la chiamata HTTP fallisce.
function _prezzoMinimoDaUrl(url, idBlueprint, apiKey) {
  var risposta = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });
  if (risposta.getResponseCode() !== 200) return null;

  var prodotti = (JSON.parse(risposta.getContentText()))[String(idBlueprint)] || [];
  var minimoCent = null;
  var valuta     = 'EUR';
  prodotti.forEach(function(p) {
    if (p.on_vacation) return;
    if (p.price && typeof p.price.cents === 'number') {
      if (minimoCent === null || p.price.cents < minimoCent) {
        minimoCent = p.price.cents;
        valuta     = p.price.currency || 'EUR';
      }
    }
  });

  return {
    prezzo: minimoCent === null ? null : parseFloat((minimoCent / 100).toFixed(2)),
    valuta: valuta
  };
}

function _fetchSealedPriceFromCardTrader(blueprintId, lingua, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };

  var idBlueprint = blueprintId ? Number(blueprintId) : null;
  if (!idBlueprint) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  var linguaCardTrader = lingua ? convertiLinguaPerCardTrader(lingua) : '';
  var urlBase = URL_BASE_API_CARDTRADER + '/marketplace/products?blueprint_id=' + idBlueprint;

  try {
    // 1° tentativo: con filtro lingua (se disponibile).
    var esito = _prezzoMinimoDaUrl(
      urlBase + (linguaCardTrader ? '&language=' + linguaCardTrader : ''),
      idBlueprint, apiKey
    );
    if (esito === null) return { success: false, price: null, message: 'Servizio non disponibile.' };

    // 2° tentativo senza lingua: alcuni sigillati non espongono la proprietà
    // lingua, quindi il filtro precedente restituisce vuoto pur essendoci
    // prodotti in vendita.
    if (esito.prezzo === null && linguaCardTrader) {
      var ripiego = _prezzoMinimoDaUrl(urlBase, idBlueprint, apiKey);
      if (ripiego) esito = ripiego;
    }

    if (esito.prezzo === null) return { success: true, price: null, message: 'Prezzo non disponibile' };
    return { success: true, price: esito.prezzo, currency: esito.valuta, message: null };
  } catch (errore) {
    Logger.log('[PRICES] _fetchSealedPriceFromCardTrader: ' + errore.message);
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}


// ════════════════════════════════════════════════════════════════════
// CHIAMATA REAL-TIME DAL FRONTEND
// ════════════════════════════════════════════════════════════════════

function getPriceForVariant(token, cardId, condizione, lingua, finitura, blueprintIdGiaNoto) {
  try {
    requireAuth(token);

    var apiKey      = getCardTraderApiKeyDellaSessione();
    var blueprintId = getBlueprintIdForCard(cardId, blueprintIdGiaNoto);
    var risultato   = _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey);

    if (risultato.success) {
      _updateLastPriceByVariant(cardId, condizione, lingua, finitura, risultato.price);
      _recalcPortfolioTotal();
    }

    return risultato;
  } catch (errore) {
    Logger.log('[PRICES] ECCEZIONE: ' + errore.message);
    if (errore.message === 'UNAUTHORIZED') {
      return { success: false, price: null, message: 'UNAUTHORIZED' };
    }
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}

// Aggiorna last_price per tutte le righe che corrispondono alla stessa variante.
function _updateLastPriceByVariant(cardId, condizione, lingua, finitura, prezzo) {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][1]) === String(cardId)     &&
          String(righe[i][3]) === String(condizione)  &&
          String(righe[i][4]) === String(lingua)      &&
          String(righe[i][5]) === String(finitura)) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] _updateLastPriceByVariant error: ' + errore.message);
  }
}

// Ricalcola il valore totale del portfolio e lo salva nel CONFIG.
function _recalcPortfolioTotal() {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    var rigaDiPartenza = _primaRigaDati(righe, 'portfolio_id');
    var valoreTotale   = 0;

    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      var prezzo = righe[i][8];
      if (prezzo !== '' && prezzo !== null && prezzo !== undefined) {
        valoreTotale += Number(prezzo) * Number(righe[i][2]);
      }
    }

    valoreTotale = parseFloat(valoreTotale.toFixed(2));
    setConfig('portfolio_total_value', valoreTotale);
    setConfig('portfolio_prices_updated', formatDate(new Date()));
  } catch (errore) {
    Logger.log('[PRICES] _recalcPortfolioTotal error: ' + errore.message);
  }
}

// Come getPriceForVariant ma per la LISTA DEI DESIDERI: aggiorna il
// last_price sul foglio WISHLIST e NON ricalcola il valore totale della
// collezione (i desideri non sono posseduti).
function getWishlistPriceForVariant(token, cardId, condizione, lingua, finitura, blueprintIdGiaNoto) {
  try {
    requireAuth(token);

    var apiKey      = getCardTraderApiKeyDellaSessione();
    var blueprintId = getBlueprintIdForCard(cardId, blueprintIdGiaNoto);
    var risultato   = _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey);

    if (risultato.success) {
      _updateWishlistLastPriceByVariant(cardId, condizione, lingua, finitura, risultato.price);
    }

    return risultato;
  } catch (errore) {
    Logger.log('[PRICES] getWishlistPriceForVariant ECCEZIONE: ' + errore.message);
    if (errore.message === 'UNAUTHORIZED') {
      return { success: false, price: null, message: 'UNAUTHORIZED' };
    }
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}

// Aggiorna last_price sul foglio WISHLIST per tutte le righe che
// corrispondono alla stessa variante.
function _updateWishlistLastPriceByVariant(cardId, condizione, lingua, finitura, prezzo) {
  try {
    var foglio = getSheet('WISHLIST');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][1]) === String(cardId)     &&
          String(righe[i][3]) === String(condizione)  &&
          String(righe[i][4]) === String(lingua)      &&
          String(righe[i][5]) === String(finitura)) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] _updateWishlistLastPriceByVariant error: ' + errore.message);
  }
}


// Come getWishlistPriceForVariant ma per il MAGAZZINO SIGILLATI: usa il
// fetch dedicato (niente condizione/finitura), aggiorna il last_price sul
// foglio SEALED_PORTFOLIO e NON tocca alcun valore totale. Il blueprint_id
// è sempre noto al frontend (arriva dal catalogo sigillati).
function getSealedPriceForVariant(token, cardId, lingua, blueprintIdGiaNoto) {
  try {
    requireAuth(token);

    var apiKey    = getCardTraderApiKeyDellaSessione();
    var risultato = _fetchSealedPriceFromCardTrader(blueprintIdGiaNoto, lingua, apiKey);

    if (risultato.success) {
      _updateSealedLastPriceByVariant(cardId, lingua, risultato.price);
    }

    return risultato;
  } catch (errore) {
    Logger.log('[PRICES] getSealedPriceForVariant ECCEZIONE: ' + errore.message);
    if (errore.message === 'UNAUTHORIZED') {
      return { success: false, price: null, message: 'UNAUTHORIZED' };
    }
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}

// Aggiorna last_price sul foglio SEALED_PORTFOLIO per tutte le righe con lo
// stesso prodotto e la stessa lingua (condizione/finitura sono placeholder
// fissi, quindi non servono al match).
function _updateSealedLastPriceByVariant(cardId, lingua, prezzo) {
  try {
    var foglio = getSheet('SEALED_PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][1]) === String(cardId) &&
          String(righe[i][4]) === String(lingua)) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] _updateSealedLastPriceByVariant error: ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// TRIGGER BATCH — aggiorna prezzi di TUTTI gli utenti (MULTI-HOP)
// ════════════════════════════════════════════════════════════════════
// Schema: ogni hop lavora per max BATCH_LIMITE_MS, salva un cursore
// (user_index, phase, row_index) in BATCH_STATE e si riprogramma con un
// trigger one-shot. updateAllUsersAllPrices() è il kickoff.
// Per ogni utente si aggiornano in ordine: PORTFOLIO (phase 0, somma al
// valore totale), WISHLIST (phase 1) e MAGAZZINO SIGILLATI (phase 2). Solo
// il portfolio contribuisce al valore totale; wishlist e sigillati no. Il
// campo `phase` del cursore dice a che punto ripartire dopo un'interruzione
// a metà utente.
// ════════════════════════════════════════════════════════════════════

var BATCH_LIMITE_MS       = 4 * 60 * 1000;
var BATCH_RITARDO_HOP_MS  = 60 * 1000;
var BATCH_FUNZIONE_WORKER = '_batchWorkerPrezzi';


// ════════════════════════════════════════════════════════════════════
// KICKOFF
// ════════════════════════════════════════════════════════════════════

function updateAllUsersAllPrices() {
  Logger.log('[BATCH] Kickoff updateAllUsersAllPrices');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000);
  } catch (e) {
    Logger.log('[BATCH] Lock non ottenuto al kickoff, skip.');
    return;
  }

  try {
    var stato = _kvLeggiTutti(_getBatchStateFoglio());
    if (String(stato.running) === 'true') {
      Logger.log('[BATCH] Giro precedente ancora in corso → skip pulito.');
      return;
    }

    _kvScriviMulti(_getBatchStateFoglio(), {
      running:       'true',
      user_index:    0,
      phase:         0,          // 0 = PORTFOLIO, 1 = WISHLIST (vedi worker)
      row_index:     0,
      partial_total: 0,
      run_started:   formatDate(new Date())
    });
  } finally {
    lock.releaseLock();
  }

  _batchWorkerPrezzi();
}


// ════════════════════════════════════════════════════════════════════
// WORKER
// ════════════════════════════════════════════════════════════════════

function _batchWorkerPrezzi() {
  var inizioHop = Date.now();
  Logger.log('[BATCH] === Hop worker start ===');

  _pulisciTrigger(BATCH_FUNZIONE_WORKER);

  var stato = _kvLeggiTutti(_getBatchStateFoglio());
  if (String(stato.running) !== 'true') {
    Logger.log('[BATCH] running != true allo start del worker → niente da fare.');
    return;
  }

  var indiceUtente   = Number(stato.user_index) || 0;
  var indiceFase     = Number(stato.phase) || 0;
  var indiceRiga     = Number(stato.row_index) || 0;
  var totaleParziale = Number(stato.partial_total) || 0;

  var foglioMaster;
  try {
    foglioMaster = getMasterSheet();
  } catch (errore) {
    Logger.log('[BATCH] Impossibile aprire master: ' + errore.message);
    _programmaTrigger(BATCH_FUNZIONE_WORKER, BATCH_RITARDO_HOP_MS);
    return;
  }

  var righeUtenti = foglioMaster.getDataRange().getValues();
  var numUtenti   = righeUtenti.length;
  Logger.log('[BATCH] Utenti totali: ' + numUtenti + ' | riparto da utente ' +
             indiceUtente + ', riga ' + indiceRiga);

  while (indiceUtente < numUtenti) {
    var username = String(righeUtenti[indiceUtente][0] || '').trim();
    var sheetId  = String(righeUtenti[indiceUtente][2] || '').trim();

    if (!username || !sheetId) {
      indiceUtente++;
      indiceFase     = 0;
      indiceRiga     = 0;
      totaleParziale = 0;
      continue;
    }

    Logger.log('[BATCH] --- Utente ' + indiceUtente + ': ' + username +
               ' (fase ' + indiceFase + ', da riga ' + indiceRiga + ') ---');

    var risultatoUtente = _processaUtenteConCheckpoint(
      username, sheetId, indiceFase, indiceRiga, totaleParziale, inizioHop
    );

    if (risultatoUtente.completato) {
      // Scrivi totale e storico, poi avanza al prossimo utente. Lo storico
      // per-carta si aggiunge qui, a giro completo: una sola riga della
      // matrice con i last_price appena aggiornati di tutte le varianti —
      // sia per il portfolio sia per la lista dei desideri.
      if (risultatoUtente.spreadsheet) {
        _aggiornaConfigUtente(risultatoUtente.spreadsheet, risultatoUtente.totale);
        _appendPriceHistoryToSheet(risultatoUtente.spreadsheet, risultatoUtente.totale);
        _appendCardHistoryRow(risultatoUtente.spreadsheet);
        _appendWishlistHistoryRow(risultatoUtente.spreadsheet);
        _appendSealedHistoryRow(risultatoUtente.spreadsheet);
      }
      Logger.log('[BATCH] ' + username + ' COMPLETATO → €' + risultatoUtente.totale);

      indiceUtente++;
      indiceFase     = 0;
      indiceRiga     = 0;
      totaleParziale = 0;

      _kvScriviMulti(_getBatchStateFoglio(), {
        user_index:    indiceUtente,
        phase:         0,
        row_index:     0,
        partial_total: 0
      });
    } else {
      _kvScriviMulti(_getBatchStateFoglio(), {
        user_index:    indiceUtente,
        phase:         risultatoUtente.prossimaFase,
        row_index:     risultatoUtente.prossimaRiga,
        partial_total: risultatoUtente.totale
      });
      Logger.log('[BATCH] Tempo scaduto su ' + username + ' (fase ' +
                 risultatoUtente.prossimaFase + ', riga ' +
                 risultatoUtente.prossimaRiga + ') → riprogrammo.');
      _programmaTrigger(BATCH_FUNZIONE_WORKER, BATCH_RITARDO_HOP_MS);
      return;
    }

    if (Date.now() - inizioHop >= BATCH_LIMITE_MS) {
      Logger.log('[BATCH] Tempo esaurito dopo un utente completo → riprogrammo.');
      _programmaTrigger(BATCH_FUNZIONE_WORKER, BATCH_RITARDO_HOP_MS);
      return;
    }
  }

  _kvScriviMulti(_getBatchStateFoglio(), { running: 'false' });
  Logger.log('[BATCH] === Giro completato. Semaforo liberato. ===');
}


// ════════════════════════════════════════════════════════════════════
// PROCESSO DI UN SINGOLO UTENTE CON CHECKPOINT
// ════════════════════════════════════════════════════════════════════

function _processaUtenteConCheckpoint(username, sheetId, faseDiPartenza, rigaDiPartenza, totaleIniziale, inizioHop) {
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(sheetId);
  } catch (errore) {
    Logger.log('[BATCH] ' + username + ': impossibile aprire sheet → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaFase: 0, prossimaRiga: 0, spreadsheet: null };
  }

  var apiKey = getCardTraderApiKey(username);
  if (!apiKey) {
    Logger.log('[BATCH] ' + username + ': API key mancante nel master → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaFase: 0, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  // Il totale della collezione è quello accumulato finora (partial_total):
  // solo la fase PORTFOLIO vi contribuisce, la WISHLIST no.
  var valoreTotale = totaleIniziale;

  // ---- FASE 0: PORTFOLIO (aggiorna i prezzi e somma al valore totale) ----
  if (faseDiPartenza <= 0) {
    var foglioPortfolio = spreadsheet.getSheetByName('PORTFOLIO');
    if (foglioPortfolio) {
      var esitoP = _prezzaRigheFoglio(
        foglioPortfolio, spreadsheet, apiKey, rigaDiPartenza, 'portfolio_id', inizioHop
      );
      valoreTotale += esitoP.totale;
      if (!esitoP.completato) {
        return {
          completato:   false,
          totale:       parseFloat(valoreTotale.toFixed(2)),
          prossimaFase: 0,
          prossimaRiga: esitoP.prossimaRiga,
          spreadsheet:  spreadsheet
        };
      }
    }
    // Portfolio completato → si passa alla wishlist ripartendo da riga 0.
    faseDiPartenza = 1;
    rigaDiPartenza = 0;
  }

  // ---- FASE 1: WISHLIST (aggiorna i prezzi ma NON tocca il valore totale) ----
  if (faseDiPartenza === 1) {
    var foglioWishlist = spreadsheet.getSheetByName('WISHLIST');
    if (foglioWishlist) {
      var esitoW = _prezzaRigheFoglio(
        foglioWishlist, spreadsheet, apiKey, rigaDiPartenza, 'wishlist_id', inizioHop
      );
      if (!esitoW.completato) {
        return {
          completato:   false,
          totale:       parseFloat(valoreTotale.toFixed(2)),
          prossimaFase: 1,
          prossimaRiga: esitoW.prossimaRiga,
          spreadsheet:  spreadsheet
        };
      }
    }
    // Wishlist completata → si passa al magazzino sigillati da riga 0.
    faseDiPartenza = 2;
    rigaDiPartenza = 0;
  }

  // ---- FASE 2: SEALED (magazzino sigillati; NON tocca il valore totale) ----
  if (faseDiPartenza === 2) {
    var foglioSealed = spreadsheet.getSheetByName('SEALED_PORTFOLIO');
    if (foglioSealed) {
      var esitoS = _prezzaRigheFoglio(
        foglioSealed, spreadsheet, apiKey, rigaDiPartenza, 'sealed_id', inizioHop,
        { sealed: true }
      );
      if (!esitoS.completato) {
        return {
          completato:   false,
          totale:       parseFloat(valoreTotale.toFixed(2)),
          prossimaFase: 2,
          prossimaRiga: esitoS.prossimaRiga,
          spreadsheet:  spreadsheet
        };
      }
    }
  }

  return {
    completato:   true,
    totale:       parseFloat(valoreTotale.toFixed(2)),
    prossimaFase: 0,
    prossimaRiga: 0,
    spreadsheet:  spreadsheet
  };
}

// Aggiorna i last_price (col 9) di un foglio "tipo portfolio" (stesse 9
// colonne: id, card_id, quantity, condition, language, finish, date_added,
// blueprint_id, last_price) a partire da `rigaDiPartenza`, rispettando il
// limite di tempo dell'hop. Restituisce { completato, prossimaRiga, totale }
// dove `totale` è la somma prezzo×quantità delle SOLE righe elaborate in
// questa chiamata (il chiamante decide se sommarla al totale utente).
// Se opzioni.sealed è true usa il fetch dei prodotti sigillati (niente
// condizione/finitura, solo lingua); altrimenti il fetch delle carte.
function _prezzaRigheFoglio(foglio, spreadsheet, apiKey, rigaDiPartenza, chiaveHeader, inizioHop, opzioni) {
  var eSigillato = !!(opzioni && opzioni.sealed);
  var ultimaRiga = foglio.getLastRow();
  if (ultimaRiga <= 1) return { completato: true, prossimaRiga: 0, totale: 0 };

  var righe         = foglio.getRange(1, 1, ultimaRiga, 9).getValues();
  var primaRigaDati = _primaRigaDati(righe, chiaveHeader);
  var i             = Math.max(rigaDiPartenza, primaRigaDati);
  var valoreTotale  = 0;

  for (; i < righe.length; i++) {
    if (Date.now() - inizioHop >= BATCH_LIMITE_MS) {
      return { completato: false, prossimaRiga: i, totale: parseFloat(valoreTotale.toFixed(2)) };
    }

    var riga = righe[i];
    if (!riga[0]) continue;

    var cardId      = String(riga[1]);
    var quantita    = Number(riga[2]);
    var condizione  = String(riga[3]);
    var lingua      = String(riga[4]);
    var finitura    = String(riga[5]);
    var blueprintId = riga[7]
      ? Number(riga[7])
      : getBlueprintIdFromSheet(spreadsheet, cardId, null);

    var vecchioPrezzoDisponibile = (riga[8] !== '' && riga[8] !== null);

    try {
      var risultato = eSigillato
        ? _fetchSealedPriceFromCardTrader(blueprintId, lingua, apiKey)
        : _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey);

      if (risultato.success && risultato.price !== null) {
        foglio.getRange(i + 1, 9).setValue(risultato.price);
        valoreTotale += risultato.price * quantita;
      } else if (vecchioPrezzoDisponibile) {
        valoreTotale += Number(riga[8]) * quantita;
      }
    } catch (errore) {
      Logger.log('[BATCH] ' + foglio.getName() + ' | ' + cardId + ' errore: ' + errore.message);
      if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
    }

    Utilities.sleep(300);
  }

  return { completato: true, prossimaRiga: 0, totale: parseFloat(valoreTotale.toFixed(2)) };
}

function _aggiornaConfigUtente(spreadsheet, valoreTotale) {
  try {
    var foglio = spreadsheet.getSheetByName('CONFIG');
    if (!foglio) foglio = spreadsheet.insertSheet('CONFIG');
    _kvScrivi(foglio, 'portfolio_total_value',    valoreTotale);
    _kvScrivi(foglio, 'portfolio_prices_updated', formatDate(new Date()));
  } catch (e) {
    Logger.log('[BATCH] _aggiornaConfigUtente: ' + e.message);
  }
}

function _appendPriceHistoryToSheet(spreadsheet, valoreTotale) {
  try {
    var foglio = spreadsheet.getSheetByName('PRICE_HISTORY');
    if (!foglio) {
      foglio = spreadsheet.insertSheet('PRICE_HISTORY');
      foglio.appendRow(['timestamp', 'total_value']);
    }
    foglio.appendRow([formatDate(new Date()), valoreTotale]);
  } catch (errore) {
    Logger.log('[BATCH] _appendPriceHistoryToSheet: ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// STORICO PREZZI PER SINGOLA VARIANTE (foglio CARD_PRICE_HISTORY)
// ════════════════════════════════════════════════════════════════════
// Struttura a MATRICE, cresce in verticale:
//   colonna A = timestamp; ogni portfolio_id è l'intestazione di una
//   colonna e sotto scorre il suo prezzo di riferimento a quel timestamp.
//     timestamp        | <pid_1> | <pid_2> | ...
//     2026-07-01 03:00 | 121.23  |  45.00  | ...
//     2026-07-02 03:00 | 122.00  |  44.50  | ...
// A differenza di last_price nel PORTFOLIO (sovrascritto), qui a ogni
// giro del batch si AGGIUNGE una riga in fondo, conservando lo storico.

// Restituisce (creandolo se manca) un foglio storico a matrice di uno
// spreadsheet utente qualsiasi (il batch opera sugli sheet di più utenti).
// Alla creazione ha la sola colonna 'timestamp': le colonne degli id
// (portfolio_id o wishlist_id) vengono aggiunte man mano dagli append.
function _getOrCreateFoglioStorico(spreadsheet, nomeFoglio) {
  var foglio = spreadsheet.getSheetByName(nomeFoglio);
  if (!foglio) {
    foglio = spreadsheet.insertSheet(nomeFoglio);
    foglio.appendRow(['timestamp']);
  }
  return foglio;
}

// Aggiunge UNA riga alla matrice storica: [timestamp, prezzo_id1, prezzo_id2, ...]
// leggendo i last_price correnti da un foglio "tipo portfolio" (id in col 1,
// last_price in col 9). Gli id non ancora presenti nell'header vengono
// aggiunti come nuove colonne in coda. Generica: la usano sia il portfolio
// (→ CARD_PRICE_HISTORY) sia la wishlist (→ WISHLIST_PRICE_HISTORY).
function _appendHistoryRowGenerico(spreadsheet, nomeFoglioDati, nomeFoglioStorico) {
  try {
    var foglioDati = spreadsheet.getSheetByName(nomeFoglioDati);
    if (!foglioDati || foglioDati.getLastRow() <= 1) return;

    var foglioStorico = _getOrCreateFoglioStorico(spreadsheet, nomeFoglioStorico);

    // Header attuale: col 1 = 'timestamp', dalla 2 in poi gli id delle voci.
    var nColonne = foglioStorico.getLastColumn();
    var header   = foglioStorico.getRange(1, 1, 1, nColonne).getValues()[0];
    var colDiId  = {};                        // id voce → indice colonna (0-based)
    for (var c = 1; c < header.length; c++) {
      if (header[c]) colDiId[String(header[c])] = c;
    }

    // last_price correnti dal foglio dati; individua gli id nuovi.
    var dati    = foglioDati.getDataRange().getValues();
    var prezzi  = {};
    var nuoviId = [];
    for (var i = 1; i < dati.length; i++) {
      var id     = String(dati[i][0]);
      var prezzo = dati[i][8];
      if (!id) continue;
      if (prezzo === '' || prezzo === null || prezzo === undefined) continue;
      prezzi[id] = Number(prezzo);
      if (colDiId[id] === undefined) {
        colDiId[id] = nColonne + nuoviId.length;
        nuoviId.push(id);
      }
    }

    if (Object.keys(prezzi).length === 0) return;  // niente prezzi → nessuna riga

    // Estende l'header con le colonne degli id nuovi.
    if (nuoviId.length > 0) {
      foglioStorico.getRange(1, nColonne + 1, 1, nuoviId.length).setValues([nuoviId]);
      nColonne += nuoviId.length;
    }

    // Riga dati larga quanto l'header, con i prezzi sotto le rispettive colonne.
    var riga = new Array(nColonne).fill('');
    riga[0] = formatDate(new Date());
    Object.keys(prezzi).forEach(function(id) { riga[colDiId[id]] = prezzi[id]; });

    foglioStorico.appendRow(riga);
  } catch (errore) {
    Logger.log('[BATCH] _appendHistoryRowGenerico (' + nomeFoglioStorico + '): ' + errore.message);
  }
}

// Wrapper: storico per-carta del PORTFOLIO.
function _appendCardHistoryRow(spreadsheet) {
  _appendHistoryRowGenerico(spreadsheet, 'PORTFOLIO', 'CARD_PRICE_HISTORY');
}

// Wrapper: storico per-carta della WISHLIST.
function _appendWishlistHistoryRow(spreadsheet) {
  _appendHistoryRowGenerico(spreadsheet, 'WISHLIST', 'WISHLIST_PRICE_HISTORY');
}

// Wrapper: storico per-prodotto del MAGAZZINO SIGILLATI.
function _appendSealedHistoryRow(spreadsheet) {
  _appendHistoryRowGenerico(spreadsheet, 'SEALED_PORTFOLIO', 'SEALED_PRICE_HISTORY');
}


// ════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════

function getDashboardData(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var risultatoPortfolio = getPortfolio(token);
    if (!risultatoPortfolio.success) return risultatoPortfolio;

    var vociPortfolio = risultatoPortfolio.items;

    var righeCarte    = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCartaSet = {};
    for (var i = 1; i < righeCarte.length; i++) {
      if (righeCarte[i][0]) {
        mappaCartaSet[String(righeCarte[i][0])] = String(righeCarte[i][2]);
      }
    }

    var totaleCarte  = 0;
    var setPosseduti = {};
    vociPortfolio.forEach(function(voce) {
      totaleCarte += voce.quantity;
      var setId = mappaCartaSet[voce.card_id];
      if (setId) setPosseduti[setId] = true;
    });

    var valoreTotale        = getConfig('portfolio_total_value');
    var ultimoAggiornamento = getConfig('portfolio_prices_updated');

    return {
      success:      true,
      total_value:  (valoreTotale !== null && valoreTotale !== '')
                      ? parseFloat(valoreTotale) : null,
      last_updated: ultimoAggiornamento || null,
      total_cards:  totaleCarte,
      total_sets:   Object.keys(setPosseduti).length
    };
  });
}


// ════════════════════════════════════════════════════════════════════
// STORICO PER-CARTA VERSO IL FRONTEND (mini-sparkline nel portfolio)
// ════════════════════════════════════════════════════════════════════
// Legge un foglio storico a matrice e lo trasforma in
// { id: [{ t, price }, ...] } con i punti in ordine di riga (cronologico).
// Se il foglio non esiste ancora (utente mai passato dal batch né dal
// seeding) torna una mappa vuota, senza errori. Generica: la usano sia lo
// storico del portfolio sia quello della wishlist.
function _leggiStoricoMatrice(nomeFoglio) {
  var foglio;
  try {
    foglio = getSheet(nomeFoglio);
  } catch (e) {
    return {};
  }

  var ultimaRiga = foglio.getLastRow();
  var ultimaCol  = foglio.getLastColumn();
  if (ultimaRiga <= 1 || ultimaCol <= 1) return {};

  // Lettura della matrice: riga 1 = header (col 1 'timestamp', poi gli id);
  // ogni riga dati porta il timestamp in col 1 e i prezzi sotto la colonna
  // del rispettivo id.
  var dati    = foglio.getRange(1, 1, ultimaRiga, ultimaCol).getValues();
  var header  = dati[0];
  var storico = {};
  for (var c = 1; c < header.length; c++) {
    if (header[c]) storico[String(header[c])] = [];
  }
  for (var r = 1; r < dati.length; r++) {
    var t = String(dati[r][0]);
    if (!t) continue;
    for (var c2 = 1; c2 < header.length; c2++) {
      var id = String(header[c2]);
      if (!id) continue;
      var prezzo = parseFloat(dati[r][c2]);
      if (isNaN(prezzo)) continue;
      storico[id].push({ t: t, price: prezzo });
    }
  }

  return storico;
}

// Storico per-carta del PORTFOLIO → { portfolio_id: [{ t, price }] }.
function getCardsPriceHistory(token) {
  return _wrapApiCall(function() {
    requireAuth(token);
    return { success: true, history: _leggiStoricoMatrice('CARD_PRICE_HISTORY') };
  });
}

// Storico per-carta della WISHLIST → { wishlist_id: [{ t, price }] }.
function getWishlistCardsPriceHistory(token) {
  return _wrapApiCall(function() {
    requireAuth(token);
    return { success: true, history: _leggiStoricoMatrice('WISHLIST_PRICE_HISTORY') };
  });
}

// Storico per-prodotto del MAGAZZINO SIGILLATI → { sealed_id: [{ t, price }] }.
function getSealedCardsPriceHistory(token) {
  return _wrapApiCall(function() {
    requireAuth(token);
    return { success: true, history: _leggiStoricoMatrice('SEALED_PRICE_HISTORY') };
  });
}


// ════════════════════════════════════════════════════════════════════
// SEEDING UNA-TANTUM DELLO STORICO PER-CARTA
// ════════════════════════════════════════════════════════════════════
// Da eseguire UNA VOLTA a mano dall'editor Apps Script dopo il rilascio.
// Per ogni utente, se lo storico è ancora vuoto, aggiunge una prima riga
// alla matrice con i last_price correnti, così le sparkline non partono
// vuote in attesa del primo giro notturno. Semina SIA il portfolio SIA la
// wishlist. Idempotente: se uno storico ha già almeno una riga dati, per
// quello non fa nulla.
function seedCardPriceHistoryAllUsers() {
  var righeUtenti = getMasterSheet().getDataRange().getValues();
  for (var u = 0; u < righeUtenti.length; u++) {
    var sheetId = String(righeUtenti[u][2] || '').trim();
    if (!sheetId) continue;
    try {
      var spreadsheet = SpreadsheetApp.openById(sheetId);

      var foglioStorico = _getOrCreateFoglioStorico(spreadsheet, 'CARD_PRICE_HISTORY');
      if (foglioStorico.getLastRow() <= 1) _appendCardHistoryRow(spreadsheet);

      var foglioStoricoWishlist = _getOrCreateFoglioStorico(spreadsheet, 'WISHLIST_PRICE_HISTORY');
      if (foglioStoricoWishlist.getLastRow() <= 1) _appendWishlistHistoryRow(spreadsheet);

      var foglioStoricoSealed = _getOrCreateFoglioStorico(spreadsheet, 'SEALED_PRICE_HISTORY');
      if (foglioStoricoSealed.getLastRow() <= 1) _appendSealedHistoryRow(spreadsheet);
    } catch (e) {
      Logger.log('[SEED] utente riga ' + u + ': ' + e.message);
    }
  }
  Logger.log('[SEED] Completato.');
}
