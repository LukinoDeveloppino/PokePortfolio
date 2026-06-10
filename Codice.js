// ============================================================
// Code.gs — Entry point, doGet, routing dispatcher
// ============================================================

function doGet(e) {
  var isMobile = e && e.parameter && e.parameter.mobile === '1';
  var templateName = isMobile ? 'mobile' : 'index';
  var template = HtmlService.createTemplateFromFile(templateName);
  var html = template.evaluate()
    .setTitle('PokéPortfolio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// Sheet helpers — dinamici per il multi-utente
// ============================================================

// Apre il Google Sheet dell'utente loggato (letto dalla sessione).
// Se sheetIdOverride è fornito, usa quello (per leggere portfolio amici).
function getSheet(name, sheetIdOverride) {
  var id = sheetIdOverride;

  if (!id) {
    // Prova a leggere dalla sessione
    var props = PropertiesService.getUserProperties();
    id = props.getProperty('session_sheet_id');
  }

  if (!id) throw new Error('Nessun foglio configurato per questa sessione.');

  try {
    var ss    = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Foglio "' + name + '" non trovato nello spreadsheet.');
    return sheet;
  } catch (e) {
    throw new Error('Impossibile aprire il foglio "' + name + '": ' + e.message);
  }
}

// Legge un valore dal CONFIG del foglio utente corrente
function getConfig(key) {
  var sheet = getSheet('CONFIG');
  var data  = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

// Scrive/aggiorna un valore nel CONFIG del foglio utente corrente
function setConfig(key, value) {
  var sheet = getSheet('CONFIG');
  var data  = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

// ============================================================
// Price history helpers
// ============================================================

function getPriceHistory(token) {
  try {
    requireAuth(token);
    var sheet = getSheet('PRICE_HISTORY');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, rows: [] };

    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      rows.push({
        timestamp: String(data[i][0]),
        value: parseFloat(data[i][1]) || 0
      });
    }
    return { success: true, rows: rows };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ============================================================
// Setup iniziale — crea i fogli nel Google Sheet dell'utente
// Da eseguire una volta manualmente dopo la registrazione,
// oppure richiamato automaticamente al primo accesso.
// ============================================================

function setupSheets() {
  // Usa il foglio dell'utente corrente (session_sheet_id)
  var props = PropertiesService.getUserProperties();
  var id    = props.getProperty('session_sheet_id');

  // Fallback: se chiamato fuori sessione, usa lo sheet hardcodato (per compatibilità)
  if (!id) {
    id = 'INSERISCI_QUI_LID_DEL_FOGLIO_UTENTE_DI_TEST';
  }

  var ss = SpreadsheetApp.openById(id);

  var sheets = {
    'CONFIG':        [['key', 'value']],
    'CACHE_CARDS':   [['id', 'name', 'set_id', 'set_name', 'set_series', 'number', 'rarity', 'types', 'image_url_small', 'image_url_large', 'set_logo_url', 'last_updated', 'blueprint_id']],
    'SET_CACHE':     [['set_id', 'set_name', 'set_series', 'set_logo_url', 'release_date', 'total_cards']],
    'PORTFOLIO':     [['portfolio_id', 'card_id', 'quantity', 'condition', 'language', 'finish', 'date_added', 'blueprint_id', 'last_price']],
    'PRICE_HISTORY': [['timestamp', 'total_value']]
  };

  for (var name in sheets) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(sheets[name][0]);
    }
  }

  // Valori CONFIG di default se non presenti
  var configDefaults = [
    ['cardtrader_api_key', 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJjYXJkdHJhZGVyLXByb2R1Y3Rpb24iLCJzdWIiOiJhcHA6MTM2MzMiLCJhdWQiOiJhcHA6MTM2MzMiLCJleHAiOjQ4OTMxNDM3NTMsImp0aSI6ImIyZTMxYTM1LWI2YmQtNGI5NS05YzZiLTMxYjdiZmQyMDFkYyIsImlhdCI6MTczNzQ3MDE1MywibmFtZSI6Ikx1a2lubzExMSBBcHAgMjAyNTAxMjExNTM1NTIifQ.gIzDEIlRVOElBGBm8PDA6_6VVq78nSlNkRAOfBqc32QHVn8E6Wrx7uP27Wia3MtTQfsYURmZf0nr6Ege5NB0J9H3WxbryYMdVVkFWhc1mw5u7Z43fmS96hshMZOhwtoTC7DfkDidXYPisMpO2XaOiePk3VFCGZbO7QYLg5dwzJ4wdpYtS6URdnN4C3Dkrz6xILUD_J9Nz-5eCvSJsgKAQ2G51IYd304c31SVQGj6L2gDttI6iQyNkI_V6AVQKnNPqcyFnl1WHGrJsx-3fCruhx6ZFaxVJIfdHmsGZiJZH-L5Pkx6C2jUfr-qslnr11cZmxbNkq9HLBMXv6XPq_8g'],
    ['pokemontcg_api_key', ''],
    ['last_catalog_sync', ''],
    ['session_duration_hours', 24],
    ['portfolio_total_value', ''],
    ['portfolio_prices_updated', '']
  ];

  var configSheet = ss.getSheetByName('CONFIG');
  var existing = configSheet.getDataRange().getValues().map(function(r) { return r[0]; });
  configDefaults.forEach(function(row) {
    if (existing.indexOf(row[0]) === -1) {
      configSheet.appendRow(row);
    }
  });
}
