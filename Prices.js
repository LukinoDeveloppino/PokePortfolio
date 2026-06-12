// ════════════════════════════════════════════════════════════════════
// Prices.gs — PREZZI DA CARDTRADER + DASHBOARD + BATCH NOTTURNO
// ════════════════════════════════════════════════════════════════════
// Questo file gestisce:
//   1. La ricerca del PREZZO MINIMO su CardTrader per una variante
//      (carta + condizione + lingua + finitura).
//   2. La chiamata real-time dal frontend quando si apre il modal carta.
//   3. Il TRIGGER BATCH (updateAllUsersAllPrices) che, agganciato a un
//      time-based trigger di Apps Script, aggiorna periodicamente i
//      prezzi di TUTTI gli utenti e salva lo storico per il grafico.
//   4. I dati per la dashboard (valore totale, n. carte, n. set).
//
// Nota: l'URL base dell'API (URL_BASE_API_CARDTRADER) è definito in Cards.gs.
// Le credenziali NON sono mai esposte al frontend: tutte le chiamate
// avvengono server-side.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// CONVERSIONI: i nostri valori → i codici usati da CardTrader
// ════════════════════════════════════════════════════════════════════

/**
 * Converte la condizione usata nell'app nel nome usato da CardTrader.
 * (es. 'Lightly Played' da noi si chiama 'Slightly Played' su CardTrader)
 */
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

/**
 * Converte il codice lingua a 3 lettere usato nell'app nel codice a 2
 * lettere usato da CardTrader. Default: inglese.
 */
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
// Il blueprint_id è l'identificativo CardTrader della carta: serve per
// interrogare il marketplace. Normalmente è già salvato nella riga del
// portfolio o nella cache carte; queste funzioni lo cercano se manca.
// ════════════════════════════════════════════════════════════════════

/**
 * Recupera il blueprint_id di una carta dalla CACHE_CARDS dell'utente
 * loggato. Se il valore è già noto (passato come parametro) lo restituisce
 * direttamente senza leggere il foglio.
 */
function getBlueprintIdForCard(cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);

  var foglio     = getSheet('CACHE_CARDS');
  var ultimaRiga = foglio.getLastRow();
  if (ultimaRiga <= 1) return null;

  var righe = foglio.getRange(1, 1, ultimaRiga, 13).getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(cardId)) {
      return righe[i][12] ? Number(righe[i][12]) : null; // colonna 13 = blueprint_id
    }
  }
  return null;
}

/**
 * Come getBlueprintIdForCard, ma cerca in uno spreadsheet ARBITRARIO
 * (passato come oggetto). Usata dal batch multi-utente, che lavora sugli
 * sheet di tutti gli utenti senza una sessione attiva.
 */
function getBlueprintIdFromSheet(spreadsheet, cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);

  try {
    var foglio = spreadsheet.getSheetByName('CACHE_CARDS');
    if (!foglio) return null;

    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return null;

    var righe = foglio.getRange(1, 1, ultimaRiga, 13).getValues();
    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][0]) === String(cardId)) {
        return righe[i][12] ? Number(righe[i][12]) : null;
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] getBlueprintIdFromSheet error: ' + errore.message);
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════
// CORE: PREZZO MINIMO DA CARDTRADER PER UNA VARIANTE
// ════════════════════════════════════════════════════════════════════

/**
 * Interroga il marketplace CardTrader e restituisce il prezzo MINIMO
 * disponibile per una variante (carta + condizione + lingua + finitura).
 *
 * La apiKey viene passata esplicitamente perché ogni utente ha la propria
 * chiave (questa funzione è usata sia dalla sessione corrente che dal batch).
 *
 * Logica di filtro dei prodotti in vendita:
 *   1. esclude i venditori "in vacanza"
 *   2. tiene solo i prodotti con la condizione richiesta
 *   3. se NESSUN prodotto ha quella condizione, accetta qualsiasi
 *      condizione (meglio un prezzo indicativo che nessun prezzo)
 *
 * @returns {{success:boolean, price:number|null, currency?:string, message:string|null}}
 *   price = prezzo in € (null se non disponibile)
 */
function _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };

  var idBlueprint = blueprintId ? Number(blueprintId) : null;
  if (!idBlueprint) {
    Logger.log('[PRICES] Nessun blueprint_id per ' + cardId);
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  Logger.log('[PRICES] blueprint_id=' + idBlueprint + ' | ' + condizione + ' | ' + lingua);

  // ---- Componi l'URL della ricerca sul marketplace ----
  var linguaCardTrader = convertiLinguaPerCardTrader(lingua);
  var url = URL_BASE_API_CARDTRADER + '/marketplace/products' +
            '?blueprint_id=' + idBlueprint +
            '&language=' + linguaCardTrader;

  // Le finiture lucide vengono cercate come "foil" su CardTrader.
  if (finitura === 'Holofoil' || finitura === 'Special') url += '&foil=true';

  // ---- Chiamata HTTP ----
  var risposta = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var codiceHttp = risposta.getResponseCode();
  Logger.log('[PRICES] HTTP ' + codiceHttp + ' → ' + url);

  if (codiceHttp !== 200) {
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }

  // La risposta è { "<blueprint_id>": [prodotto, prodotto, ...] }
  var prodottiInVendita = (JSON.parse(risposta.getContentText()))[String(idBlueprint)] || [];
  Logger.log('[PRICES] Prodotti trovati: ' + prodottiInVendita.length);

  if (prodottiInVendita.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  // ---- Filtro per condizione (con fallback a "qualsiasi condizione") ----
  var condizioneCardTrader = convertiCondizionePerCardTrader(condizione);

  var prodottiFiltrati = prodottiInVendita.filter(function(prodotto) {
    return !prodotto.on_vacation &&
           (!prodotto.properties_hash ||
            !prodotto.properties_hash.condition ||
            prodotto.properties_hash.condition === condizioneCardTrader);
  });

  // Nessun prodotto con quella condizione? Accetta qualsiasi condizione
  // (continuando comunque a escludere i venditori in vacanza).
  if (prodottiFiltrati.length === 0) {
    prodottiFiltrati = prodottiInVendita.filter(function(prodotto) {
      return !prodotto.on_vacation;
    });
  }
  if (prodottiFiltrati.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  // ---- Trova il prezzo minimo (i prezzi sono in centesimi) ----
  var prezzoMinimoInCentesimi = null;
  var valuta = 'EUR';

  prodottiFiltrati.forEach(function(prodotto) {
    if (prodotto.price && typeof prodotto.price.cents === 'number') {
      if (prezzoMinimoInCentesimi === null || prodotto.price.cents < prezzoMinimoInCentesimi) {
        prezzoMinimoInCentesimi = prodotto.price.cents;
        valuta = prodotto.price.currency || 'EUR';
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
// CHIAMATA REAL-TIME DAL FRONTEND (apertura modal carta)
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce il prezzo aggiornato di una variante. Chiamata dal frontend
 * ogni volta che si apre il modal di una carta.
 *
 * Effetti collaterali (se la chiamata riesce):
 *   • aggiorna la colonna last_price nel foglio PORTFOLIO
 *   • ricalcola e salva il valore totale del portfolio nel CONFIG
 */
function getPriceForVariant(token, cardId, condizione, lingua, finitura, blueprintIdGiaNoto) {
  try {
    requireAuth(token);

    var apiKey      = getConfig('cardtrader_api_key');
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

/**
 * Aggiorna la colonna last_price (colonna 9) per TUTTE le righe del
 * portfolio che corrispondono alla stessa variante
 * (stessa carta + condizione + lingua + finitura).
 */
function _updateLastPriceByVariant(cardId, condizione, lingua, finitura, prezzo) {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      var stessaVariante =
        String(righe[i][1]) === String(cardId)     && // card_id
        String(righe[i][3]) === String(condizione) && // condition
        String(righe[i][4]) === String(lingua)     && // language
        String(righe[i][5]) === String(finitura);     // finish

      if (stessaVariante) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] _updateLastPriceByVariant error: ' + errore.message);
  }
}

/**
 * Ricalcola il valore totale del portfolio sommando
 * (last_price × quantity) di ogni voce, e salva il risultato nel CONFIG
 * insieme alla data dell'aggiornamento. Letto poi da getDashboardData.
 */
function _recalcPortfolioTotal() {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    var rigaDiPartenza = (righe.length > 0 && righe[0][0] === 'portfolio_id') ? 1 : 0;
    var valoreTotale   = 0;

    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      var prezzo = righe[i][8]; // colonna 9 = last_price
      if (prezzo !== '' && prezzo !== null && prezzo !== undefined) {
        valoreTotale += Number(prezzo) * Number(righe[i][2]); // × quantity
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
// TRIGGER BATCH — aggiorna i prezzi di TUTTI gli utenti
// ════════════════════════════════════════════════════════════════════
// Questa funzione va agganciata a un time-based trigger di Apps Script
// (es. ogni notte). Per ogni utente del foglio master:
//   • aggiorna last_price di ogni voce del suo portfolio
//   • ricalcola e salva il valore totale
//   • aggiunge una riga allo storico PRICE_HISTORY (per il grafico)
// ════════════════════════════════════════════════════════════════════

/**
 * Entry point del batch: cicla su tutti gli utenti registrati nel master.
 * Gli errori su un utente non bloccano gli altri.
 */
function updateAllUsersAllPrices() {
  Logger.log('[BATCH] Inizio updateAllUsersAllPrices');

  var foglioMaster;
  try {
    foglioMaster = getMasterSheet();
  } catch (errore) {
    Logger.log('[BATCH] Impossibile aprire master: ' + errore.message);
    return;
  }

  var righeUtenti = foglioMaster.getDataRange().getValues();
  Logger.log('[BATCH] Utenti nel master: ' + righeUtenti.length);

  for (var u = 0; u < righeUtenti.length; u++) {
    var username = String(righeUtenti[u][0] || '').trim();
    var sheetId  = String(righeUtenti[u][2] || '').trim();
    if (!username || !sheetId) continue; // riga incompleta

    Logger.log('[BATCH] --- Utente: ' + username + ' ---');
    try {
      _updatePricesForUser(username, sheetId);
    } catch (errore) {
      Logger.log('[BATCH] Errore utente ' + username + ': ' + errore.message);
    }
  }

  Logger.log('[BATCH] Fine updateAllUsersAllPrices');
}

/**
 * Aggiorna i prezzi di TUTTE le voci del portfolio di un singolo utente.
 * Usata solo dal batch (nessuna sessione attiva: si lavora direttamente
 * sullo spreadsheet dell'utente).
 */
function _updatePricesForUser(username, sheetId) {
  // ---- Apri lo spreadsheet dell'utente ----
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(sheetId);
  } catch (errore) {
    Logger.log('[BATCH] ' + username + ': impossibile aprire sheet');
    return;
  }

  // ---- Recupera la sua API key (ognuno ha la propria) ----
  var apiKey = _getConfigFromSheet(spreadsheet, 'cardtrader_api_key');
  if (!apiKey) {
    Logger.log('[BATCH] ' + username + ': API key mancante, skip');
    return;
  }

  var foglioPortfolio = spreadsheet.getSheetByName('PORTFOLIO');
  if (!foglioPortfolio) {
    Logger.log('[BATCH] ' + username + ': PORTFOLIO non trovato');
    return;
  }

  var ultimaRiga = foglioPortfolio.getLastRow();
  if (ultimaRiga <= 1) {
    Logger.log('[BATCH] ' + username + ': portfolio vuoto');
    return;
  }

  var righe          = foglioPortfolio.getRange(1, 1, ultimaRiga, 9).getValues();
  var rigaDiPartenza = (righe[0][0] === 'portfolio_id') ? 1 : 0;
  var valoreTotale   = 0;

  // ---- Ciclo su ogni voce del portfolio ----
  for (var i = rigaDiPartenza; i < righe.length; i++) {
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

    // Vecchio prezzo (riusato nel totale se l'aggiornamento fallisce).
    var vecchioPrezzoDisponibile = (riga[8] !== '' && riga[8] !== null);

    try {
      var risultato = _fetchPriceFromCardTrader(
        cardId, condizione, lingua, finitura, blueprintId, apiKey
      );

      if (risultato.success && risultato.price !== null) {
        // Nuovo prezzo trovato: salvalo e sommalo al totale.
        foglioPortfolio.getRange(i + 1, 9).setValue(risultato.price);
        valoreTotale += risultato.price * quantita;
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' → €' + risultato.price);
      } else {
        // Prezzo non trovato: mantieni il vecchio nel totale (se c'era).
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' → ' +
                   (risultato.message || 'N/D'));
        if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
      }
    } catch (errore) {
      Logger.log('[BATCH] ' + username + ' | ' + cardId + ' errore: ' + errore.message);
      if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
    }

    // Pausa fra una carta e l'altra per non saturare l'API CardTrader.
    Utilities.sleep(300);
  }

  // ---- Salva totale, data aggiornamento e riga di storico ----
  valoreTotale = parseFloat(valoreTotale.toFixed(2));
  _setConfigInSheet(spreadsheet, 'portfolio_total_value', valoreTotale);
  _setConfigInSheet(spreadsheet, 'portfolio_prices_updated', formatDate(new Date()));
  _appendPriceHistoryToSheet(spreadsheet, valoreTotale);

  Logger.log('[BATCH] ' + username + ' → totale: €' + valoreTotale);
}


// ════════════════════════════════════════════════════════════════════
// HELPER DEL BATCH — versioni di getConfig/setConfig che lavorano su uno
// spreadsheet arbitrario (il batch non ha una sessione, quindi non può
// usare le funzioni di Code.gs che leggono lo sheet della sessione).
// ════════════════════════════════════════════════════════════════════

/** Legge una chiave dal foglio CONFIG di uno spreadsheet arbitrario. */
function _getConfigFromSheet(spreadsheet, chiave) {
  try {
    var foglio = spreadsheet.getSheetByName('CONFIG');
    if (!foglio) return null;

    var righe = foglio.getDataRange().getValues();
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === chiave) return righe[i][1];
    }
  } catch (errore) {
    Logger.log('[BATCH] _getConfigFromSheet: ' + errore.message);
  }
  return null;
}

/** Scrive (o aggiorna) una chiave nel foglio CONFIG di uno spreadsheet arbitrario. */
function _setConfigInSheet(spreadsheet, chiave, valore) {
  try {
    var foglio = spreadsheet.getSheetByName('CONFIG');
    if (!foglio) return;

    var righe = foglio.getDataRange().getValues();
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === chiave) {
        foglio.getRange(i + 1, 2).setValue(valore);
        return;
      }
    }
    foglio.appendRow([chiave, valore]);
  } catch (errore) {
    Logger.log('[BATCH] _setConfigInSheet: ' + errore.message);
  }
}

/**
 * Aggiunge una riga [timestamp, totale] al foglio PRICE_HISTORY di uno
 * spreadsheet arbitrario, creando il foglio se non esiste ancora.
 */
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
// DASHBOARD — statistiche del portfolio
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce le statistiche mostrate in cima alla sezione Portfolio:
 *   • valore totale (calcolato dall'ultimo aggiornamento prezzi)
 *   • numero totale di carte (somma delle quantità)
 *   • numero di set "coperti" (set con almeno una carta posseduta)
 *   • data dell'ultimo aggiornamento prezzi
 */
function getDashboardData(token) {
  try {
    requireAuth(token);

    var risultatoPortfolio = getPortfolio(token);
    if (!risultatoPortfolio.success) return risultatoPortfolio;

    var vociPortfolio = risultatoPortfolio.items;

    // ---- Mappa card_id → set_id dalla cache (per contare i set coperti) ----
    var righeCarte    = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCartaSet = {};
    for (var i = 1; i < righeCarte.length; i++) {
      if (righeCarte[i][0]) {
        mappaCartaSet[String(righeCarte[i][0])] = String(righeCarte[i][2]);
      }
    }

    // ---- Conta carte totali e set distinti ----
    var totaleCarte   = 0;
    var setPosseduti  = {};

    vociPortfolio.forEach(function(voce) {
      totaleCarte += voce.quantity;
      var setId = mappaCartaSet[voce.card_id];
      if (setId) setPosseduti[setId] = true;
    });

    // ---- Valore totale e data: già calcolati e salvati nel CONFIG ----
    var valoreTotale       = getConfig('portfolio_total_value');
    var ultimoAggiornamento = getConfig('portfolio_prices_updated');

    return {
      success:      true,
      total_value:  (valoreTotale !== null && valoreTotale !== '')
                      ? parseFloat(valoreTotale)
                      : null,
      last_updated: ultimoAggiornamento || null,
      total_cards:  totaleCarte,
      total_sets:   Object.keys(setPosseduti).length
    };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}
