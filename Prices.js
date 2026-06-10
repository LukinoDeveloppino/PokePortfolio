// ============================================================
// Prices.gs - CardTrader API prezzi
// ============================================================

var CARDTRADER_BASE = 'https://api.cardtrader.com/api/v2';
var POKEMON_GAME_ID = 5;

var JP_SET_TO_CT_EXPANSION = {
  'zsv10pt5': 4188,
  'rsv10pt5': 4189
};

var JP_SET_PREFIXES = ['rsv', 'zsv'];

// Cache in-memory per sessione GAS
var _expansionCache = null;
var _blueprintCache = {};

// Converte condizione -> CardTrader
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

// Converte lingua -> codice 2 lettere CardTrader
function languageToCardTrader(language) {
  var map = {
    'ITA':'it','ENG':'en','JPN':'jp','DEU':'de',
    'FRA':'fr','ESP':'es','KOR':'kr','POR':'pt'
  };
  return map[language] || 'en';
}

// ---- Recupera blueprint_id dalla CACHE_CARDS di uno sheet specifico ----

function _getBlueprintIdForCardInSheet(ss, cardId, portfolioBlueprintId) {
  if (portfolioBlueprintId) return Number(portfolioBlueprintId);
  try {
    var sheet = ss.getSheetByName('CACHE_CARDS');
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;
    var data = sheet.getRange(1, 1, lastRow, 13).getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cardId)) {
        return data[i][12] ? Number(data[i][12]) : null;
      }
    }
  } catch (e) {
    Logger.log('[PRICES] _getBlueprintIdForCardInSheet error: ' + e.message);
  }
  return null;
}

// ---- Recupera blueprint_id dalla CACHE_CARDS dell'utente corrente (sessione) ----

function getBlueprintIdForCard(cardId, portfolioBlueprintId) {
  if (portfolioBlueprintId) return Number(portfolioBlueprintId);
  var sheet = getSheet('CACHE_CARDS');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var data = sheet.getRange(1, 1, lastRow, 13).getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardId)) {
      return data[i][12] ? Number(data[i][12]) : null;
    }
  }
  return null;
}

// ---- Core: recupera prezzo minimo da CardTrader ----
// apiKey va passato esplicitamente (ogni utente ha la propria chiave)

function _fetchPriceFromCardTrader(cardId, condition, language, finish, blueprintId, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };
  var headers = { 'Authorization': 'Bearer ' + apiKey };

  var bpId = blueprintId ? Number(blueprintId) : null;
  if (!bpId) {
    Logger.log('[PRICES] Nessun blueprint_id per ' + cardId);
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  Logger.log('[PRICES] blueprint_id=' + bpId + ' | condizione=' + condition + ' | lingua=' + language);

  var ctLanguage = languageToCardTrader(language);
  var url = CARDTRADER_BASE + '/marketplace/products?blueprint_id=' + bpId +
            '&language=' + ctLanguage;
  if (finish === 'Holofoil' || finish === 'Special') url += '&foil=true';

  Logger.log('[PRICES] GET ' + url);
  var resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  var code = resp.getResponseCode();
  Logger.log('[PRICES] HTTP ' + code);

  if (code !== 200) return { success: false, price: null, message: 'Servizio non disponibile.' };

  var mktData = JSON.parse(resp.getContentText());
  var products = mktData[String(bpId)] || [];
  Logger.log('[PRICES] Prodotti trovati: ' + products.length);

  if (products.length === 0) return { success: true, price: null, message: 'Prezzo non disponibile' };

  var ctCondition = conditionToCardTrader(condition);
  var filtered = products.filter(function(p) {
    return !p.on_vacation &&
           (!p.properties_hash || !p.properties_hash.condition ||
            p.properties_hash.condition === ctCondition);
  });
  if (filtered.length === 0) filtered = products.filter(function(p) { return !p.on_vacation; });
  if (filtered.length === 0) return { success: true, price: null, message: 'Prezzo non disponibile' };

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
  Logger.log('[PRICES] Prezzo: ' + (minPrice/100).toFixed(2) + ' ' + currency);
  return { success: true, price: parseFloat((minPrice/100).toFixed(2)), currency: currency, message: null };
}

// ---- Chiamata dal frontend (modal) - usa la sessione corrente ----

function getPriceForVariant(token, cardId, condition, language, finish, knownBlueprintId) {
  try {
    requireAuth(token);
    var apiKey = getConfig('cardtrader_api_key');
    var bpId = getBlueprintIdForCard(cardId, knownBlueprintId);
    var result = _fetchPriceFromCardTrader(cardId, condition, language, finish, bpId, apiKey);

    if (result.success) {
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

// Aggiorna last_price (col 9) per le righe che corrispondono alla variante (sessione corrente)
function _updateLastPriceByVariant(cardId, condition, language, finish, price) {
  try {
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(cardId) &&
          String(data[i][3]) === String(condition) &&
          String(data[i][4]) === String(language) &&
          String(data[i][5]) === String(finish)) {
        sheet.getRange(i + 1, 9).setValue(price !== null ? price : '');
      }
    }
  } catch (e) {
    Logger.log('[PRICES] _updateLastPriceByVariant error: ' + e.message);
  }
}

// ============================================================
// BATCH MULTI-UTENTE - da agganciare al trigger GAS
// Aggiorna prezzi di TUTTI gli utenti registrati nel master.
// Per ogni utente: aggiorna last_price nel suo PORTFOLIO,
// salva il totale nel suo CONFIG, scrive nel suo PRICE_HISTORY.
// ============================================================

function updateAllUsersAllPrices() {
  Logger.log('[BATCH-MULTI] Inizio updateAllUsersAllPrices');

  var master;
  try {
    master = getMasterSheet();
  } catch (e) {
    Logger.log('[BATCH-MULTI] Impossibile aprire il foglio master: ' + e.message);
    return;
  }

  var masterData = master.getDataRange().getValues();
  Logger.log('[BATCH-MULTI] Utenti nel master: ' + masterData.length);

  for (var u = 0; u < masterData.length; u++) {
    var username = String(masterData[u][0] || '').trim();
    var sheetId  = String(masterData[u][2] || '').trim();

    if (!username || !sheetId) {
      Logger.log('[BATCH-MULTI] Riga ' + u + ' vuota, skip.');
      continue;
    }

    Logger.log('[BATCH-MULTI] --- Utente: ' + username + ' ---');

    try {
      _updatePricesForUser(username, sheetId);
    } catch (e) {
      Logger.log('[BATCH-MULTI] Errore utente ' + username + ': ' + e.message);
      // Continua con il prossimo utente
    }
  }

  Logger.log('[BATCH-MULTI] Fine updateAllUsersAllPrices');
}

// ---- Aggiorna prezzi per un singolo utente ----

function _updatePricesForUser(username, sheetId) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    Logger.log('[BATCH] ' + username + ': impossibile aprire lo sheet (' + e.message + ')');
    return;
  }

  // Legge API key CardTrader dal CONFIG dell'utente
  var apiKey = _getConfigFromSheet(ss, 'cardtrader_api_key');
  if (!apiKey) {
    Logger.log('[BATCH] ' + username + ': API key CardTrader mancante, skip.');
    return;
  }

  var portfolioSheet = ss.getSheetByName('PORTFOLIO');
  if (!portfolioSheet) {
    Logger.log('[BATCH] ' + username + ': foglio PORTFOLIO non trovato, skip.');
    return;
  }

  var lastRow = portfolioSheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('[BATCH] ' + username + ': portfolio vuoto, skip.');
    return;
  }

  var data = portfolioSheet.getRange(1, 1, lastRow, 9).getValues();
  var startRow = (data[0][0] === 'portfolio_id') ? 1 : 0;
  var totalValue = 0;

  for (var i = startRow; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    var cardId      = String(row[1]);
    var quantity    = Number(row[2]);
    var condition   = String(row[3]);
    var language    = String(row[4]);
    var finish      = String(row[5]);
    var blueprintId = row[7] ? Number(row[7]) : null;

    // Se blueprint_id non e' nella riga, prova a cercarlo nella CACHE_CARDS
    if (!blueprintId) {
      blueprintId = _getBlueprintIdForCardInSheet(ss, cardId, null);
    }

    try {
      var result = _fetchPriceFromCardTrader(cardId, condition, language, finish, blueprintId, apiKey);

      if (result.success && result.price !== null) {
        portfolioSheet.getRange(i + 1, 9).setValue(result.price);
        totalValue += result.price * quantity;
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' -> EUR ' + result.price);
      } else {
        Logger.log('[BATCH] ' + username + ' | ' + cardId + ' -> ' + (result.message || 'N/D'));
        // Mantiene il vecchio prezzo per il totale
        if (row[8] !== '' && row[8] !== null && row[8] !== undefined) {
          totalValue += Number(row[8]) * quantity;
        }
      }
    } catch (e) {
      Logger.log('[BATCH] ' + username + ' | ' + cardId + ' errore: ' + e.message);
      if (row[8] !== '' && row[8] !== null && row[8] !== undefined) {
        totalValue += Number(row[8]) * quantity;
      }
    }

    // Pausa per non saturare l'API CardTrader
    Utilities.sleep(300);
  }

  totalValue = parseFloat(totalValue.toFixed(2));

  // Salva totale e timestamp nel CONFIG dell'utente
  _setConfigInSheet(ss, 'portfolio_total_value', totalValue);
  _setConfigInSheet(ss, 'portfolio_prices_updated', formatDate(new Date()));

  // Aggiunge riga al PRICE_HISTORY dell'utente
  _appendPriceHistoryToSheet(ss, totalValue);

  Logger.log('[BATCH] ' + username + ' -> totale: EUR ' + totalValue);
}

// ---- Helper: legge un valore dal CONFIG di uno sheet specifico ----

function _getConfigFromSheet(ss, key) {
  try {
    var sheet = ss.getSheetByName('CONFIG');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) return data[i][1];
    }
  } catch (e) {
    Logger.log('[BATCH] _getConfigFromSheet error: ' + e.message);
  }
  return null;
}

// ---- Helper: scrive un valore nel CONFIG di uno sheet specifico ----

function _setConfigInSheet(ss, key, value) {
  try {
    var sheet = ss.getSheetByName('CONFIG');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  } catch (e) {
    Logger.log('[BATCH] _setConfigInSheet error: ' + e.message);
  }
}

// ---- Helper: aggiunge riga al PRICE_HISTORY di uno sheet specifico ----

function _appendPriceHistoryToSheet(ss, totalValue) {
  try {
    var sheet = ss.getSheetByName('PRICE_HISTORY');
    if (!sheet) {
      Logger.log('[BATCH] PRICE_HISTORY non trovato, creo il foglio.');
      sheet = ss.insertSheet('PRICE_HISTORY');
      sheet.appendRow(['timestamp', 'total_value']);
    }
    sheet.appendRow([formatDate(new Date()), totalValue]);
  } catch (e) {
    Logger.log('[BATCH] _appendPriceHistoryToSheet error: ' + e.message);
  }
}

// ---- Ricalcola totale portfolio dai last_price salvati (sessione corrente) ----

function _recalcPortfolioTotal() {
  try {
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();
    var startRow = (data.length > 0 && data[0][0] === 'portfolio_id') ? 1 : 0;
    var total = 0;
    for (var i = startRow; i < data.length; i++) {
      if (!data[i][0]) continue;
      var qty = Number(data[i][2]);
      var price = data[i][8];
      if (price !== '' && price !== null && price !== undefined) {
        total += Number(price) * qty;
      }
    }
    total = parseFloat(total.toFixed(2));
    setConfig('portfolio_total_value', total);
    setConfig('portfolio_prices_updated', formatDate(new Date()));
  } catch (e) {
    Logger.log('[PRICES] _recalcPortfolioTotal error: ' + e.message);
  }
}

// ---- Scrive una riga nel PRICE_HISTORY dell'utente in sessione ----

function _appendPriceHistory(totalValue) {
  try {
    var sheet = getSheet('PRICE_HISTORY');
    sheet.appendRow([formatDate(new Date()), totalValue]);
  } catch (e) {
    Logger.log('[PRICES] _appendPriceHistory error: ' + e.message);
  }
}

// ---- Lettura totale e statistiche per la Dashboard ----

function getDashboardData(token) {
  try {
    requireAuth(token);

    var totalValue  = getConfig('portfolio_total_value');
    var lastUpdated = getConfig('portfolio_prices_updated');

    var portfolioResult = getPortfolio(token);
    if (!portfolioResult.success) return portfolioResult;

    var items = portfolioResult.items;
    var totalCards = 0;
    var setIds = {};

    var cardSheet = getSheet('CACHE_CARDS');
    var cardData = cardSheet.getDataRange().getValues();
    var cardSetMap = {};
    for (var i = 1; i < cardData.length; i++) {
      if (cardData[i][0]) cardSetMap[String(cardData[i][0])] = String(cardData[i][2]);
    }

    items.forEach(function(item) {
      totalCards += item.quantity;
      var setId = cardSetMap[item.card_id];
      if (setId) setIds[setId] = true;
    });

    return {
      success:      true,
      total_value:  totalValue !== null && totalValue !== '' ? parseFloat(totalValue) : null,
      last_updated: lastUpdated || null,
      total_cards:  totalCards,
      total_sets:   Object.keys(setIds).length
    };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Funzione debug ----

function debugAllPokemonSets() {
  var apiKey = getConfig('cardtrader_api_key');
  var headers = { 'Authorization': 'Bearer ' + apiKey };
  var resp = UrlFetchApp.fetch(CARDTRADER_BASE + '/expansions', { headers: headers, muteHttpExceptions: true });
  var raw = JSON.parse(resp.getContentText());
  var expansions = (raw && raw.array) ? raw.array : raw;
  var pokemon = expansions.filter(function(e) { return e.game_id === 5; });
  Logger.log('[DEBUG] Totale espansioni Pokemon su CardTrader: ' + pokemon.length);
  pokemon.forEach(function(e) {
    Logger.log('[DEBUG] id=' + e.id + ' | code="' + e.code + '" | name="' + e.name + '"');
  });
}
