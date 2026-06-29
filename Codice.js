// ════════════════════════════════════════════════════════════════════
// Code.gs — PUNTO DI INGRESSO DELLA WEBAPP
// ════════════════════════════════════════════════════════════════════
// Contiene:
//   1. doGet / include         → entry point e helper template HTML
//   2. getSheet                → apre un foglio dell'utente (o del master)
//   3. getConfig / setConfig   → chiave→valore nel foglio CONFIG utente
//   4. API key CardTrader      → lettura dalla colonna D del master
//   5. Parametri globali master → chiave→valore in BATCH_STATE
//   6. creaFoglioUtente        → setup sheet alla registrazione
//   7. getPriceHistory         → storico valori per il grafico
//   8. setupSheets             → setup manuale (legacy)
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// 1. ENTRY POINT
// ════════════════════════════════════════════════════════════════════

function doGet(e) {
  var nomeTemplate = (e && e.parameter && e.parameter.mobile === '1') ? 'mobile' : 'desktop';
  return HtmlService.createTemplateFromFile(nomeTemplate)
    .evaluate()
    .setTitle('PokéPortfolio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nomeFile) {
  return HtmlService.createHtmlOutputFromFile(nomeFile).getContent();
}


// ════════════════════════════════════════════════════════════════════
// 2. ACCESSO AL GOOGLE SHEET DELL'UTENTE
// ════════════════════════════════════════════════════════════════════
// I fogli CACHE_CARDS e SET_CACHE sono centralizzati nel master:
// getSheet() li reindirizza automaticamente, così il resto del codice
// non ha bisogno di sapere dove vivono.
// ════════════════════════════════════════════════════════════════════

// Usato come dizionario per lookup O(1) invece che indexOf su array.
var FOGLI_NEL_MASTER = { CACHE_CARDS: true, SET_CACHE: true };

function getMasterSheetByName(nomeFoglio) {
  try {
    var foglio = _getMasterSpreadsheet().getSheetByName(nomeFoglio);
    if (!foglio) throw new Error('Foglio "' + nomeFoglio + '" non trovato nel master.');
    return foglio;
  } catch (errore) {
    throw new Error('Impossibile aprire il foglio master "' + nomeFoglio + '": ' + errore.message);
  }
}

function getSheet(nomeFoglio, idSheetAlternativo) {
  if (FOGLI_NEL_MASTER[nomeFoglio]) return getMasterSheetByName(nomeFoglio);

  var idSpreadsheet =
    idSheetAlternativo ||
    PropertiesService.getUserProperties().getProperty('session_sheet_id');

  if (!idSpreadsheet) throw new Error('Nessun foglio configurato per questa sessione.');

  try {
    var foglio = SpreadsheetApp.openById(idSpreadsheet).getSheetByName(nomeFoglio);
    if (!foglio) throw new Error('Foglio "' + nomeFoglio + '" non trovato nello spreadsheet.');
    return foglio;
  } catch (errore) {
    throw new Error('Impossibile aprire il foglio "' + nomeFoglio + '": ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// 3. LETTURA / SCRITTURA DEL FOGLIO CONFIG UTENTE
// ════════════════════════════════════════════════════════════════════

function getConfig(chiave) {
  return _kvLeggi(getSheet('CONFIG'), chiave);
}

function setConfig(chiave, valore) {
  _kvScrivi(getSheet('CONFIG'), chiave, valore);
}


// ════════════════════════════════════════════════════════════════════
// 4. API KEY CARDTRADER — colonna D del master
// ════════════════════════════════════════════════════════════════════

function getCardTraderApiKey(username) {
  try {
    var righe = getMasterSheet().getDataRange().getValues();

    if (username) {
      var cercato = String(username).trim().toLowerCase();
      for (var i = 0; i < righe.length; i++) {
        if (String(righe[i][0]).trim().toLowerCase() === cercato) {
          var keyUtente = String(righe[i][3] || '').trim();
          if (keyUtente) return keyUtente;
          break;
        }
      }
    }

    for (var r = 0; r < righe.length; r++) {
      var key = String(righe[r][3] || '').trim();
      if (key) return key;
    }

    return '';
  } catch (errore) {
    return '';
  }
}

function getCardTraderApiKeyDellaSessione() {
  var username = PropertiesService.getUserProperties().getProperty('session_username');
  return getCardTraderApiKey(username);
}


// ════════════════════════════════════════════════════════════════════
// 5. PARAMETRI GLOBALI NEL MASTER (foglio BATCH_STATE)
// ════════════════════════════════════════════════════════════════════

function getParametroMaster(chiave) {
  try {
    return _kvLeggi(_getBatchStateFoglio(), chiave) || '';
  } catch (errore) {
    Logger.log('[MASTER] getParametroMaster: ' + errore.message);
    return '';
  }
}

function setParametroMaster(chiave, valore) {
  _kvScrivi(_getBatchStateFoglio(), chiave, valore);
}

function getTokenDiDefault() {
  return getParametroMaster('default_token');
}


// ════════════════════════════════════════════════════════════════════
// 6. CREAZIONE DEL FOGLIO UTENTE (fase di registrazione)
// ════════════════════════════════════════════════════════════════════

var NOME_CARTELLA_UTENTI = 'PokePortfolio - Utenti';

// Struttura dei fogli utente: nome → intestazione.
// NOTA: CACHE_CARDS e SET_CACHE NON sono qui, vivono nel master.
var STRUTTURA_FOGLIO_UTENTE = {
  CONFIG:        ['key', 'value'],
  PORTFOLIO:     ['portfolio_id', 'card_id', 'quantity', 'condition',
                  'language', 'finish', 'date_added', 'blueprint_id', 'last_price'],
  PRICE_HISTORY: ['timestamp', 'total_value']
};

// Valori di default scritti nel foglio CONFIG alla creazione.
var DEFAULT_CONFIG_UTENTE = [
  ['pokemontcg_api_key',       ''],
  ['session_duration_hours',   24],
  ['portfolio_total_value',    ''],
  ['portfolio_prices_updated', '']
];

function _getCartellaUtenti() {
  var idCartella = getParametroMaster('cartella_utenti_id');
  if (idCartella) {
    try { return DriveApp.getFolderById(idCartella); } catch (e) {}
  }
  var cartella = DriveApp.createFolder(NOME_CARTELLA_UTENTI);
  setParametroMaster('cartella_utenti_id', cartella.getId());
  return cartella;
}

function creaFoglioUtente(username) {
  var spreadsheet = SpreadsheetApp.create('PokePortfolio-' + username);

  Object.keys(STRUTTURA_FOGLIO_UTENTE).forEach(function(nomeFoglio) {
    spreadsheet.insertSheet(nomeFoglio).appendRow(STRUTTURA_FOGLIO_UTENTE[nomeFoglio]);
  });

  var foglioDefault = spreadsheet.getSheetByName('Foglio1') ||
                      spreadsheet.getSheetByName('Sheet1');
  if (foglioDefault) spreadsheet.deleteSheet(foglioDefault);

  var foglioConfig = spreadsheet.getSheetByName('CONFIG');
  DEFAULT_CONFIG_UTENTE.forEach(function(riga) { foglioConfig.appendRow(riga); });

  try {
    var file = DriveApp.getFileById(spreadsheet.getId());
    _getCartellaUtenti().addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    Logger.log('[REGISTRA] Spostamento in cartella fallito: ' + e.message);
  }

  return spreadsheet.getId();
}


// ════════════════════════════════════════════════════════════════════
// 7. STORICO PREZZI (per il grafico nella sezione Portfolio)
// ════════════════════════════════════════════════════════════════════

function getPriceHistory(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var foglio     = getSheet('PRICE_HISTORY');
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return { success: true, rows: [] };

    var risultato = foglio.getRange(2, 1, ultimaRiga - 1, 2).getValues()
      .filter(function(r) { return r[0]; })
      .map(function(r) {
        return { timestamp: String(r[0]), value: parseFloat(r[1]) || 0 };
      });

    return { success: true, rows: risultato };
  });
}


// ════════════════════════════════════════════════════════════════════
// 8. SETUP INIZIALE (legacy — da eseguire manualmente una sola volta)
// ════════════════════════════════════════════════════════════════════

function setupSheets() {
  var proprietaUtente = PropertiesService.getUserProperties();
  var idSpreadsheet   = proprietaUtente.getProperty('session_sheet_id');
  if (!idSpreadsheet) idSpreadsheet = 'INSERISCI_QUI_LID_DEL_FOGLIO_UTENTE_DI_TEST';

  var spreadsheet = SpreadsheetApp.openById(idSpreadsheet);

  Object.keys(STRUTTURA_FOGLIO_UTENTE).forEach(function(nomeFoglio) {
    if (!spreadsheet.getSheetByName(nomeFoglio)) {
      spreadsheet.insertSheet(nomeFoglio).appendRow(STRUTTURA_FOGLIO_UTENTE[nomeFoglio]);
    }
  });

  var foglioConfig    = spreadsheet.getSheetByName('CONFIG');
  var chiaviEsistenti = foglioConfig.getDataRange().getValues()
    .map(function(riga) { return riga[0]; });

  DEFAULT_CONFIG_UTENTE.forEach(function(coppia) {
    if (chiaviEsistenti.indexOf(coppia[0]) === -1) foglioConfig.appendRow(coppia);
  });
}
