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


// ════════════════════════════════════════════════════════════════════
// TRIGGER BATCH — aggiorna prezzi di TUTTI gli utenti (MULTI-HOP)
// ════════════════════════════════════════════════════════════════════
// Schema: ogni hop lavora per max BATCH_LIMITE_MS, salva un cursore
// (user_index, row_index) in BATCH_STATE e si riprogramma con un
// trigger one-shot. updateAllUsersAllPrices() è il kickoff.
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
      indiceRiga     = 0;
      totaleParziale = 0;
      continue;
    }

    Logger.log('[BATCH] --- Utente ' + indiceUtente + ': ' + username +
               ' (da riga ' + indiceRiga + ') ---');

    var risultatoUtente = _processaUtenteConCheckpoint(
      username, sheetId, indiceRiga, totaleParziale, inizioHop
    );

    if (risultatoUtente.completato) {
      // Scrivi totale e storico, poi avanza al prossimo utente.
      if (risultatoUtente.spreadsheet) {
        _aggiornaConfigUtente(risultatoUtente.spreadsheet, risultatoUtente.totale);
        _appendPriceHistoryToSheet(risultatoUtente.spreadsheet, risultatoUtente.totale);
      }
      Logger.log('[BATCH] ' + username + ' COMPLETATO → €' + risultatoUtente.totale);

      indiceUtente++;
      indiceRiga     = 0;
      totaleParziale = 0;

      _kvScriviMulti(_getBatchStateFoglio(), {
        user_index:    indiceUtente,
        row_index:     0,
        partial_total: 0
      });
    } else {
      _kvScriviMulti(_getBatchStateFoglio(), {
        user_index:    indiceUtente,
        row_index:     risultatoUtente.prossimaRiga,
        partial_total: risultatoUtente.totale
      });
      Logger.log('[BATCH] Tempo scaduto su ' + username +
                 ' alla riga ' + risultatoUtente.prossimaRiga + ' → riprogrammo.');
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

function _processaUtenteConCheckpoint(username, sheetId, rigaDiPartenza, totaleIniziale, inizioHop) {
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(sheetId);
  } catch (errore) {
    Logger.log('[BATCH] ' + username + ': impossibile aprire sheet → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: null };
  }

  var apiKey = getCardTraderApiKey(username);
  if (!apiKey) {
    Logger.log('[BATCH] ' + username + ': API key mancante nel master → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var foglioPortfolio = spreadsheet.getSheetByName('PORTFOLIO');
  if (!foglioPortfolio) {
    Logger.log('[BATCH] ' + username + ': PORTFOLIO non trovato → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var ultimaRiga = foglioPortfolio.getLastRow();
  if (ultimaRiga <= 1) {
    Logger.log('[BATCH] ' + username + ': portfolio vuoto.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var righe         = foglioPortfolio.getRange(1, 1, ultimaRiga, 9).getValues();
  var primaRigaDati = _primaRigaDati(righe, 'portfolio_id');
  var i             = Math.max(rigaDiPartenza, primaRigaDati);
  var valoreTotale  = totaleIniziale;

  for (; i < righe.length; i++) {
    if (Date.now() - inizioHop >= BATCH_LIMITE_MS) {
      return {
        completato:   false,
        totale:       parseFloat(valoreTotale.toFixed(2)),
        prossimaRiga: i,
        spreadsheet:  spreadsheet
      };
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
      var risultato = _fetchPriceFromCardTrader(
        cardId, condizione, lingua, finitura, blueprintId, apiKey
      );

      if (risultato.success && risultato.price !== null) {
        foglioPortfolio.getRange(i + 1, 9).setValue(risultato.price);
        valoreTotale += risultato.price * quantita;
      } else if (vecchioPrezzoDisponibile) {
        valoreTotale += Number(riga[8]) * quantita;
      }
    } catch (errore) {
      Logger.log('[BATCH] ' + username + ' | ' + cardId + ' errore: ' + errore.message);
      if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
    }

    Utilities.sleep(300);
  }

  return {
    completato:   true,
    totale:       parseFloat(valoreTotale.toFixed(2)),
    prossimaRiga: 0,
    spreadsheet:  spreadsheet
  };
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
