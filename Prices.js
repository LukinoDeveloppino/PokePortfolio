// ============================================================
// Prices.gs — Prezzi da CardTrader API
// ============================================================

var CARDTRADER_BASE = 'https://api.cardtrader.com/api/v2';

// ---- Conversioni condizione/lingua → codici CardTrader ----

function conditionToCardTrader(condition) {
  var map = {
    'Near Mint':         'Near Mint',
    'Lightly Played':    'Slightly Played',
    'Moderately Played': 'Moderately Played',
    'Heavily Played':    'Heavily Played',
    'Damaged':           'Poor'
  };
  return map[condition] || condition;
}

function languageToCardTrader(language) {
  var map = { 'ITA':'it','ENG':'en','JPN':'jp','DEU':'de','FRA':'fr','ESP':'es','KOR':'kr','POR':'pt' };
  return map[language] || 'en';
}

// ---- Recupera blueprint_id dalla CACHE_CARDS (sessione corrente) ----
// Ritorna il valore già noto se fornito, altrimenti cerca nel foglio.
function getBlueprintIdForCard(cardId, knownBlueprintId) {
  if (knownBlueprintId) return Number(knownBlueprintId);
  var sheet   = getSheet('CACHE_CARDS');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var data = sheet.getRange(1, 1, lastRow, 13).getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardId)) return data[i][12] ? Number(data[i][12]) : null;
  }
  return null;
}

// Variante per sheet arbitrario (usata nel batch multi-utente)
function getBlueprintIdFromSheet(ss, cardId, knownBlueprintId) {
  if (knownBlueprintId) return Number(knownBlueprintId);
  try {
    var sheet = ss.getSheetByName('CACHE_CARDS');
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;
    var data = sheet.getRange(1, 1, lastRow, 13).getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cardId)) return data[i][12] ? Number(data[i][12]) : null;
    }
  } catch (e) {
    Logger.log('[PRICES] getBlueprintIdFromSheet error: ' + e.message);
  }
  return null;
}

// ============================================================
// Core: recupera il prezzo minimo da CardTrader per una variante
// apiKey viene passato esplicitamente (ogni utente ha la propria chiave)
// ============================================================

function _fetchPriceFromCardTrader(cardId, condition, language, finish, blueprintId, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };

  var bpId = blueprintId ? Number(blueprintId) : null;
  if (!bpId) {
    Logger.log('[PRICES] Nessun blueprint_id per ' + cardId);
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  Logger.log('[PRICES] blueprint_id=' + bpId + ' | ' + condition + ' | ' + language);

  var ctLanguage = languageToCardTrader(language);
  var url = CARDTRADER_BASE + '/marketplace/products?blueprint_id=' + bpId + '&language=' + ctLanguage;
  if (finish === 'Holofoil' || finish === 'Special') url += '&foil=true';

  var resp = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  Logger.log('[PRICES] HTTP ' + code + ' → ' + url);

  if (code !== 200) return { success: false, price: null, message: 'Servizio non disponibile.' };

  var products = (JSON.parse(resp.getContentText()))[String(bpId)] || [];
  Logger.log('[PRICES] Prodotti trovati: ' + products.length);
  if (products.length === 0) return { success: true, price: null, message: 'Prezzo non disponibile' };

  var ctCondition = conditionToCardTrader(condition);

  // Filtra per condizione; se nessun risultato, accetta qualsiasi condizione (esclude vacanze)
  var filtered = products.filter(function(p) {
    return !p.on_vacation &&
           (!p.properties_hash || !p.properties_hash.condition ||
            p.properties_hash.condition === ctCondition);
  });
  if (filtered.length === 0) filtered = products.filter(function(p) { return !p.on_vacation; });
  if (filtered.length === 0) return { success: true, price: null, message: 'Prezzo non disponibile' };

  // Trova il prezzo minimo
  var minPrice = null, currency = 'EUR';
  filtered.forEach(function(p) {
    if (p.price && typeof p.price.cents === 'number') {
      if (minPrice === null || p.price.cents < minPrice) {
        minPrice = p.price.cents;
        currency = p.price.currency || 'EUR';
      }
    }
  });

  if (minPrice === null) return { success: true, price: null, message: 'Prezzo non disponibile' };
  var price = parseFloat((minPrice / 100).toFixed(2));
  Logger.log('[PRICES] Prezzo: ' + price + ' ' + currency);
  return { success: true, price: price, currency: currency, message: null };
}

// ============================================================
// Chiamata dal frontend (modal) — sessione corrente
// ============================================================

function getPriceForVariant(token, cardId, condition, language, finish, knownBlueprintId) {
  try {
    requireAuth(token);
    var apiKey = getConfig('cardtrader_api_key');
    var bpId   = getBlueprintIdForCard(cardId, knownBlueprintId);
    var result = _fetchPriceFromCardTrader(cardId, condition, language, finish, bpId, apiKey);

    if (result.success) {
      // Aggiorna last_price nel foglio e ricalcola il totale
      _updateLastPriceByVariant(cardId, condition, language, finish, result.price);
      _recalcPortfolioTotal();
    }
    return result;
  } catch (e) {
    Logger.log('[PRICES] ECCEZIONE: ' + e.message);
    if (e.message === 'UNAUTHORIZED') return { success: false, price: null, message: 'UNAUTHORIZED' };
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}

// Aggiorna la colonna last_price (col 9) per tutte le righe che corrispondono alla variante
function _updateLastPriceByVariant(cardId, condition, language, finish, price) {
  try {
    var sheet = getSheet('PORTFOLIO');
    var data  = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(cardId) &&
          String(data[i][3]) === String(condition) &&
          String(data[i][4]) === String(language)  &&
          String(data[i][5]) === String(finish)) {
        sheet.getRange(i + 1, 9).setValue(price !== null ? price : '');
      }
    }
  } catch (e) {
    Logger.log('[PRICES] _updateLastPriceByVariant error: ' + e.message);
  }
}

// Ricalcola il totale del portfolio dai last_price salvati e lo scrive nel CONFIG
function _recalcPortfolioTotal() {
  try {
    var sheet = getSheet('PORTFOLIO');
    var data  = sheet.getDataRange().getValues();
    var start = (data.length > 0 && data[0][0] === 'portfolio_id') ? 1 : 0;
    var total = 0;
    for (var i = start; i < data.length; i++) {
      if (!data[i][0]) continue;
      var price = data[i][8];
      if (price !== '' && price !== null && price !== undefined) {
        total += Number(price) * Number(data[i][2]);
      }
    }
    total = parseFloat(total.toFixed(2));
    setConfig('portfolio_total_value', total);
    setConfig('portfolio_prices_updated', formatDate(new Date()));
  } catch (e) {
    Logger.log('[PRICES] _recalcPortfolioTotal error: ' + e.message);
  }
}

// ============================================================
// Trigger batch — aggiorna prezzi di tutti gli utenti del master
// Da agganciare a un time-based trigger in GAS
// ============================================================

function updateAllUsersAllPrices() {
  Logger.log('[BATCH] Inizio updateAllUsersAllPrices');

  var master;
  try { master = getMasterSheet(); }
  catch (e) { Logger.log('[BATCH] Impossibile aprire master: ' + e.message); return; }

  var masterData = master.getDataRange().getValues();
  Logger.log('[BATCH] Utenti nel master: ' + masterData.length);

  for (var u = 0; u < masterData.length; u++) {
    var username = String(masterData[u][0] || '').trim();
    var sheetId  = String(masterData[u][2] || '').trim();
    if (!username || !sheetId) continue;
    Logger.log('[BATCH] --- Utente: ' + username + ' ---');
    try { _updatePricesForUser(username, sheetId); }
    catch (e) { Logger.log('[BATCH] Errore utente ' + username + ': ' + e.message); }
  }

  Logger.log('[BATCH] Fine updateAllUsersAllPrices');
}

// Aggiorna prezzi per un singolo utente (usato dal batch)
function _updatePricesForUser(username, sheetId) {
  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) { Logger.log('[BATCH] ' + username + ': impossibile aprire sheet'); return; }

  var apiKey = _getConfigFromSheet(ss, 'cardtrader_api_key');
  if (!apiKey) { Logger.log('[BATCH] ' + username + ': API key mancante, skip'); return; }

  var portfolioSheet = ss.getSheetByName('PORTFOLIO');
  if (!portfolioSheet) { Logger.log('[BATCH] ' + username + ': PORTFOLIO non trovato'); return; }

  var lastRow = portfolioSheet.getLastRow();
  if (lastRow <= 1) { Logger.log('[BATCH] ' + username + ': portfolio vuoto'); return; }

  var data     = portfolioSheet.getRange(1, 1, lastRow, 9).getValues();
  var startRow = (data[0][0] === 'portfolio_id') ? 1 : 0;
  var total    = 0;

  for (var i = startRow; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    var cardId      = String(row[1]);
    var quantity    = Number(row[2]);
    var condition   = String(row[3]);
    var language    = String(row[4]);
    var finish      = String(row[5]);
    var blueprintId = row[7] ? Number(row[7]) : getBlueprintIdFromSheet(ss, cardId, null);

    try {
      var result = _fetchPriceFromCardTrader(cardId, condition, language, finish, blueprintId, apiKey);
      if (result.success && result.price !== null) {
        portfolioSheet.getRange(i + 1, 9).setValue(result.price);
        total += result.price * quantity;
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' → €' + result.price);
      } else {
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' → ' + (result.message || 'N/D'));
        // Mantiene il vecchio prezzo nel totale se disponibile
        if (row[8] !== '' && row[8] !== null) total += Number(row[8]) * quantity;
      }
    } catch (e) {
      Logger.log('[BATCH] ' + username + ' | ' + cardId + ' errore: ' + e.message);
      if (row[8] !== '' && row[8] !== null) total += Number(row[8]) * quantity;
    }

    Utilities.sleep(300); // Pausa per non saturare l'API CardTrader
  }

  total = parseFloat(total.toFixed(2));
  _setConfigInSheet(ss, 'portfolio_total_value', total);
  _setConfigInSheet(ss, 'portfolio_prices_updated', formatDate(new Date()));
  _appendPriceHistoryToSheet(ss, total);
  Logger.log('[BATCH] ' + username + ' → totale: €' + total);
}

// ---- Helper batch: legge/scrive CONFIG e PRICE_HISTORY su sheet arbitrario ----

function _getConfigFromSheet(ss, key) {
  try {
    var sheet = ss.getSheetByName('CONFIG');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) return data[i][1];
    }
  } catch (e) { Logger.log('[BATCH] _getConfigFromSheet: ' + e.message); }
  return null;
}

function _setConfigInSheet(ss, key, value) {
  try {
    var sheet = ss.getSheetByName('CONFIG');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) { sheet.getRange(i + 1, 2).setValue(value); return; }
    }
    sheet.appendRow([key, value]);
  } catch (e) { Logger.log('[BATCH] _setConfigInSheet: ' + e.message); }
}

function _appendPriceHistoryToSheet(ss, total) {
  try {
    var sheet = ss.getSheetByName('PRICE_HISTORY');
    if (!sheet) {
      sheet = ss.insertSheet('PRICE_HISTORY');
      sheet.appendRow(['timestamp', 'total_value']);
    }
    sheet.appendRow([formatDate(new Date()), total]);
  } catch (e) { Logger.log('[BATCH] _appendPriceHistoryToSheet: ' + e.message); }
}

// ============================================================
// Dashboard — statistiche portfolio
// ============================================================

function getDashboardData(token) {
  try {
    requireAuth(token);

    var result = getPortfolio(token);
    if (!result.success) return result;

    // Conta carte totali e set coperti
    var items      = result.items;
    var totalCards = 0;
    var setIds     = {};

    // Mappa card_id → set_id dalla cache
    var cardData = getSheet('CACHE_CARDS').getDataRange().getValues();
    var cardSetMap = {};
    for (var i = 1; i < cardData.length; i++) {
      if (cardData[i][0]) cardSetMap[String(cardData[i][0])] = String(cardData[i][2]);
    }

    items.forEach(function(item) {
      totalCards += item.quantity;
      var setId = cardSetMap[item.card_id];
      if (setId) setIds[setId] = true;
    });

    var totalValue  = getConfig('portfolio_total_value');
    var lastUpdated = getConfig('portfolio_prices_updated');

    return {
      success:      true,
      total_value:  (totalValue !== null && totalValue !== '') ? parseFloat(totalValue) : null,
      last_updated: lastUpdated || null,
      total_cards:  totalCards,
      total_sets:   Object.keys(setIds).length
    };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}
