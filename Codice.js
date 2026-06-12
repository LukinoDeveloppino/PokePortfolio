// ════════════════════════════════════════════════════════════════════
// Code.gs — PUNTO DI INGRESSO DELLA WEBAPP
// ════════════════════════════════════════════════════════════════════
// Questo file contiene:
//   1. doGet()        → la funzione che Google Apps Script chiama quando
//                       qualcuno apre l'URL della webapp
//   2. include()      → helper per iniettare style.html e script.html
//   3. getSheet()     → apre un foglio del Google Sheet dell'utente loggato
//   4. getConfig() /
//      setConfig()    → leggono/scrivono coppie chiave-valore nel foglio CONFIG
//   5. getPriceHistory() → legge lo storico valori per il grafico
//   6. setupSheets()  → setup iniziale (crea i fogli mancanti)
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// 1. ENTRY POINT
// ════════════════════════════════════════════════════════════════════

/**
 * Funzione chiamata automaticamente da Google Apps Script quando un utente
 * apre l'URL della webapp.
 *
 * Se l'URL contiene il parametro ?mobile=1 viene servita la versione mobile
 * (file mobile.html), altrimenti la versione desktop (file index.html).
 */
function doGet(richiestaHttp) {
  var vuoleVersioneMobile =
    richiestaHttp &&
    richiestaHttp.parameter &&
    richiestaHttp.parameter.mobile === '1';

  var nomeTemplate = vuoleVersioneMobile ? 'mobile' : 'index';

  return HtmlService.createTemplateFromFile(nomeTemplate)
    .evaluate()
    .setTitle('PokéPortfolio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper usato DENTRO i template HTML (con la sintassi <?!= include('style'); ?>)
 * per incorporare il contenuto di un altro file HTML del progetto.
 * Serve a tenere CSS (style.html) e JavaScript (script.html) in file separati.
 */
function include(nomeFile) {
  return HtmlService.createHtmlOutputFromFile(nomeFile).getContent();
}


// ════════════════════════════════════════════════════════════════════
// 2. ACCESSO AL GOOGLE SHEET DELL'UTENTE
// ════════════════════════════════════════════════════════════════════
// L'app è multi-utente: ogni utente ha il SUO Google Sheet personale.
// L'ID di quel foglio viene salvato in PropertiesService al momento del
// login (vedi Auth.gs) e recuperato qui ad ogni operazione.
// ════════════════════════════════════════════════════════════════════

/**
 * Apre un foglio (tab) del Google Sheet dell'utente attualmente loggato.
 *
 * @param {string} nomeFoglio          - es. 'CONFIG', 'PORTFOLIO', 'CACHE_CARDS'
 * @param {string} [idSheetAlternativo] - opzionale: ID di uno sheet diverso da
 *                                        quello della sessione. Usato per leggere
 *                                        il portfolio di un amico (vedi Friends.gs).
 * @returns {Sheet} il foglio richiesto
 * @throws  {Error} se nessuno sheet è configurato o il foglio non esiste
 */
function getSheet(nomeFoglio, idSheetAlternativo) {
  var idSpreadsheet =
    idSheetAlternativo ||
    PropertiesService.getUserProperties().getProperty('session_sheet_id');

  if (!idSpreadsheet) {
    throw new Error('Nessun foglio configurato per questa sessione.');
  }

  try {
    var foglio = SpreadsheetApp.openById(idSpreadsheet).getSheetByName(nomeFoglio);
    if (!foglio) {
      throw new Error('Foglio "' + nomeFoglio + '" non trovato nello spreadsheet.');
    }
    return foglio;
  } catch (errore) {
    throw new Error('Impossibile aprire il foglio "' + nomeFoglio + '": ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// 3. LETTURA / SCRITTURA DEL FOGLIO CONFIG
// ════════════════════════════════════════════════════════════════════
// Il foglio CONFIG è una semplice tabella a due colonne:
//   colonna A = nome della chiave   (es. 'cardtrader_api_key')
//   colonna B = valore della chiave (es. 'eyJhbGci...')
// ════════════════════════════════════════════════════════════════════

/**
 * Legge il valore associato a una chiave nel foglio CONFIG dell'utente loggato.
 * Restituisce null se la chiave non esiste.
 */
function getConfig(chiave) {
  var righe = getSheet('CONFIG').getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (righe[i][0] === chiave) return righe[i][1];
  }
  return null;
}

/**
 * Scrive (o aggiorna se già esiste) una coppia chiave-valore nel foglio CONFIG
 * dell'utente loggato.
 */
function setConfig(chiave, valore) {
  var foglio = getSheet('CONFIG');
  var righe  = foglio.getDataRange().getValues();

  // Se la chiave esiste già, aggiorna il valore nella stessa riga...
  for (var i = 0; i < righe.length; i++) {
    if (righe[i][0] === chiave) {
      foglio.getRange(i + 1, 2).setValue(valore); // colonna 2 = colonna B (valore)
      return;
    }
  }
  // ...altrimenti aggiungi una nuova riga in fondo.
  foglio.appendRow([chiave, valore]);
}


// ════════════════════════════════════════════════════════════════════
// 4. STORICO PREZZI (per il grafico nella sezione Portfolio)
// ════════════════════════════════════════════════════════════════════
// Il foglio PRICE_HISTORY ha due colonne:
//   colonna A = timestamp ('yyyy-MM-dd HH:mm:ss')
//   colonna B = valore totale del portfolio in quel momento (€)
// Le righe vengono aggiunte dal trigger batch (vedi Prices.gs).
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce tutte le righe dello storico valori del portfolio.
 * Chiamata dal frontend per disegnare il grafico "Andamento valore".
 *
 * @param {string} token - token di sessione dell'utente
 * @returns {{success:boolean, rows?:Array, error?:string}}
 */
function getPriceHistory(token) {
  try {
    requireAuth(token); // lancia 'UNAUTHORIZED' se il token non è valido

    var foglio      = getSheet('PRICE_HISTORY');
    var ultimaRiga  = foglio.getLastRow();

    // Se c'è solo l'intestazione (o il foglio è vuoto) non ci sono dati.
    if (ultimaRiga <= 1) return { success: true, rows: [] };

    // Legge tutte le righe dati (dalla 2 in poi), colonne A e B.
    var righe    = foglio.getRange(2, 1, ultimaRiga - 1, 2).getValues();
    var risultato = [];

    for (var i = 0; i < righe.length; i++) {
      if (!righe[i][0]) continue; // salta eventuali righe vuote
      risultato.push({
        timestamp: String(righe[i][0]),
        value:     parseFloat(righe[i][1]) || 0
      });
    }

    return { success: true, rows: risultato };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// 5. SETUP INIZIALE
// ════════════════════════════════════════════════════════════════════
// Da eseguire UNA VOLTA manualmente (dall'editor di Apps Script) dopo la
// registrazione di un nuovo utente: crea nel suo Google Sheet tutti i
// fogli necessari con le intestazioni corrette, e inserisce i valori di
// default nel foglio CONFIG.
// ════════════════════════════════════════════════════════════════════

// ⚠️ ATTENZIONE: questa è una API key CardTrader scritta in chiaro nel codice.
// Viene usata da setupSheets() come valore di default per i nuovi utenti.
// Sarebbe più sicuro NON tenerla nel codice e inserirla a mano nel foglio
// CONFIG di ogni utente.
var CHIAVE_API_CARDTRADER_DI_DEFAULT = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJjYXJkdHJhZGVyLXByb2R1Y3Rpb24iLCJzdWIiOiJhcHA6MTM2MzMiLCJhdWQiOiJhcHA6MTM2MzMiLCJleHAiOjQ4OTMxNDM3NTMsImp0aSI6ImIyZTMxYTM1LWI2YmQtNGI5NS05YzZiLTMxYjdiZmQyMDFkYyIsImlhdCI6MTczNzQ3MDE1MywibmFtZSI6Ikx1a2lubzExMSBBcHAgMjAyNTAxMjExNTM1NTIifQ.gIzDEIlRVOElBGBm8PDA6_6VVq78nSlNkRAOfBqc32QHVn8E6Wrx7uP27Wia3MtTQfsYURmZf0nr6Ege5NB0J9H3WxbryYMdVVkFWhc1mw5u7Z43fmS96hshMZOhwtoTC7DfkDidXYPisMpO2XaOiePk3VFCGZbO7QYLg5dwzJ4wdpYtS6URdnN4C3Dkrz6xILUD_J9Nz-5eCvSJsgKAQ2G51IYd304c31SVQGj6L2gDttI6iQyNkI_V6AVQKnNPqcyFnl1WHGrJsx-3fCruhx6ZFaxVJIfdHmsGZiJZH-L5Pkx6C2jUfr-qslnr11cZmxbNkq9HLBMXv6XPq_8g';

/**
 * Crea (se non esistono già) tutti i fogli necessari nel Google Sheet
 * dell'utente, ognuno con la sua riga di intestazione, e popola il foglio
 * CONFIG con i valori di default — senza mai sovrascrivere valori esistenti.
 */
function setupSheets() {
  // Prova a usare lo sheet della sessione corrente; in alternativa va
  // inserito a mano l'ID del foglio dell'utente da inizializzare.
  var proprietaUtente = PropertiesService.getUserProperties();
  var idSpreadsheet   = proprietaUtente.getProperty('session_sheet_id');
  if (!idSpreadsheet) idSpreadsheet = 'INSERISCI_QUI_LID_DEL_FOGLIO_UTENTE_DI_TEST';

  var spreadsheet = SpreadsheetApp.openById(idSpreadsheet);

  // ---- Struttura dei fogli: nome foglio → riga di intestazione ----
  var strutturaFogli = {
    'CONFIG':        ['key', 'value'],

    'CACHE_CARDS':   ['id', 'name', 'set_id', 'set_name', 'set_series', 'number',
                      'rarity', 'types', 'image_url_small', 'image_url_large',
                      'set_logo_url', 'last_updated', 'blueprint_id'],

    'SET_CACHE':     ['set_id', 'set_name', 'set_series', 'set_logo_url',
                      'release_date', 'total_cards'],

    'PORTFOLIO':     ['portfolio_id', 'card_id', 'quantity', 'condition',
                      'language', 'finish', 'date_added', 'blueprint_id',
                      'last_price'],

    'PRICE_HISTORY': ['timestamp', 'total_value']
  };

  // Crea ogni foglio mancante con la sua intestazione.
  for (var nomeFoglio in strutturaFogli) {
    if (!spreadsheet.getSheetByName(nomeFoglio)) {
      spreadsheet.insertSheet(nomeFoglio).appendRow(strutturaFogli[nomeFoglio]);
    }
  }

  // ---- Valori di default per CONFIG (non sovrascrive quelli esistenti) ----
  var foglioConfig   = spreadsheet.getSheetByName('CONFIG');
  var chiaviEsistenti = foglioConfig.getDataRange().getValues()
    .map(function(riga) { return riga[0]; });

  var valoriDiDefault = [
    ['cardtrader_api_key',       CHIAVE_API_CARDTRADER_DI_DEFAULT],
    ['pokemontcg_api_key',       ''],
    ['last_catalog_sync',        ''],
    ['session_duration_hours',   24],
    ['portfolio_total_value',    ''],
    ['portfolio_prices_updated', '']
  ];

  valoriDiDefault.forEach(function(coppiaChiaveValore) {
    var chiave = coppiaChiaveValore[0];
    if (chiaviEsistenti.indexOf(chiave) === -1) {
      foglioConfig.appendRow(coppiaChiaveValore);
    }
  });
}
