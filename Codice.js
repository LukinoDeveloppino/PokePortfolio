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

// ════════════════════════════════════════════════════════════════════
// FOGLI CENTRALIZZATI NEL MASTER (catalogo condiviso da tutti gli utenti)
// ════════════════════════════════════════════════════════════════════
// CACHE_CARDS e SET_CACHE non vivono più nello sheet del singolo utente:
// stanno in un'unica copia nel Google Sheet MASTER, condivisa da tutti.
// Qualunque richiesta a getSheet() per questi due fogli viene quindi
// reindirizzata automaticamente al master, così tutto il codice di lettura
// del catalogo (Cards.gs) continua a funzionare senza modifiche.
// ════════════════════════════════════════════════════════════════════

// Fogli che NON appartengono all'utente ma al master condiviso.
var FOGLI_NEL_MASTER = ['CACHE_CARDS', 'SET_CACHE'];

/**
 * Apre un foglio (tab) per nome direttamente nello spreadsheet MASTER.
 * Usato per il catalogo condiviso (CACHE_CARDS, SET_CACHE) e da chi deve
 * leggere/scrivere fogli del master a prescindere dalla sessione utente
 * (es. la sync del catalogo, che gira da trigger senza utente loggato).
 *
 * @param {string} nomeFoglio - es. 'CACHE_CARDS', 'SET_CACHE'
 * @returns {Sheet} il foglio richiesto nel master
 * @throws  {Error} se il foglio non esiste nel master
 */
function getMasterSheetByName(nomeFoglio) {
  try {
    var foglio = SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI).getSheetByName(nomeFoglio);
    if (!foglio) {
      throw new Error('Foglio "' + nomeFoglio + '" non trovato nel master.');
    }
    return foglio;
  } catch (errore) {
    throw new Error('Impossibile aprire il foglio master "' + nomeFoglio + '": ' + errore.message);
  }
}

/**
 * Apre un foglio (tab) del Google Sheet dell'utente attualmente loggato.
 *
 * NOTA: i fogli del catalogo condiviso (CACHE_CARDS, SET_CACHE) vengono
 * reindirizzati automaticamente al master, ignorando sia la sessione sia
 * un eventuale idSheetAlternativo: il catalogo è uno solo per tutti.
 *
 * @param {string} nomeFoglio          - es. 'CONFIG', 'PORTFOLIO', 'CACHE_CARDS'
 * @param {string} [idSheetAlternativo] - opzionale: ID di uno sheet diverso da
 *                                        quello della sessione. Usato per leggere
 *                                        il portfolio di un amico (vedi Friends.gs).
 * @returns {Sheet} il foglio richiesto
 * @throws  {Error} se nessuno sheet è configurato o il foglio non esiste
 */
function getSheet(nomeFoglio, idSheetAlternativo) {
  // Catalogo condiviso: sempre dal master, mai dallo sheet utente.
  if (FOGLI_NEL_MASTER.indexOf(nomeFoglio) !== -1) {
    return getMasterSheetByName(nomeFoglio);
  }

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
// 3b. API KEY CARDTRADER — letta dalla COLONNA D del master
// ════════════════════════════════════════════════════════════════════
// La API key di CardTrader non sta più nel CONFIG del singolo utente:
// sta nel foglio elenco-utenti del master, una per utente:
//   colonna A = username
//   colonna B = hash password
//   colonna C = ID sheet personale
//   colonna D = cardtrader_api_key   ← qui
//
// • Le operazioni interattive (prezzi nel modal, dashboard, export...)
//   usano la key DELL'UTENTE LOGGATO → getCardTraderApiKey(username).
// • La sync del catalogo gira da trigger, senza utente: usa la PRIMA
//   key trovata nell'elenco (di norma il proprietario) →
//   getCardTraderApiKey() senza argomenti.
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce la API key CardTrader dalla colonna D del master.
 *
 * @param {string} [username] - se indicato, cerca la riga di quell'utente
 *                              (case-insensitive); se assente o non trovato,
 *                              restituisce la prima key non vuota dell'elenco.
 * @returns {string} la API key, o stringa vuota se nessuna è disponibile.
 */
function getCardTraderApiKey(username) {
  try {
    var righe = getMasterSheet().getDataRange().getValues();

    // Caso 1: cerca la key dello username indicato.
    if (username) {
      var cercato = String(username).trim().toLowerCase();
      for (var i = 0; i < righe.length; i++) {
        if (String(righe[i][0]).trim().toLowerCase() === cercato) {
          var keyUtente = String(righe[i][3] || '').trim();
          if (keyUtente) return keyUtente;
          break; // utente trovato ma senza key: ricade sul fallback sotto
        }
      }
    }

    // Caso 2 (fallback / sync): prima key non vuota dell'elenco.
    for (var r = 0; r < righe.length; r++) {
      var key = String(righe[r][3] || '').trim();
      if (key) return key;
    }

    return '';
  } catch (errore) {
    return '';
  }
}

/**
 * Variante che ricava lo username direttamente dalla sessione corrente
 * (UserProperties) e restituisce la sua key CardTrader. Comoda per le
 * funzioni interattive che hanno già validato il token ma non passano
 * lo username in giro.
 */
function getCardTraderApiKeyDellaSessione() {
  var username = PropertiesService.getUserProperties().getProperty('session_username');
  return getCardTraderApiKey(username);
}


// ════════════════════════════════════════════════════════════════════
// 3c. PARAMETRI GLOBALI NEL MASTER (foglio BATCH_STATE, chiave→valore)
// ════════════════════════════════════════════════════════════════════
// Nel master il foglio BATCH_STATE funge anche da "tabella parametri":
// righe chiave (colonna A) → valore (colonna B). Oltre allo stato dei
// batch (prezzi e sync), contiene parametri di configurazione globali:
//   default_token       → API key CardTrader di default per chi si registra
//                          senza fornirne una (impostata a mano)
//   cartella_utenti_id  → ID della cartella Drive che raccoglie i fogli
//                          utente (scritta dal codice la prima volta)
// ════════════════════════════════════════════════════════════════════

var NOME_FOGLIO_PARAMETRI_MASTER = 'BATCH_STATE';

/** Apre (creandolo se manca) il foglio parametri BATCH_STATE nel master. */
function _getFoglioParametriMaster() {
  var master = SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI);
  var foglio = master.getSheetByName(NOME_FOGLIO_PARAMETRI_MASTER);
  if (!foglio) foglio = master.insertSheet(NOME_FOGLIO_PARAMETRI_MASTER);
  return foglio;
}

/**
 * Legge un parametro globale per chiave dal foglio BATCH_STATE del master.
 * @returns {string} il valore, o '' se la chiave non esiste.
 */
function getParametroMaster(chiave) {
  try {
    var righe = _getFoglioParametriMaster().getDataRange().getValues();
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === chiave) return String(righe[i][1] || '');
    }
  } catch (errore) {
    Logger.log('[MASTER] getParametroMaster: ' + errore.message);
  }
  return '';
}

/** Scrive (o aggiorna) un parametro globale per chiave nel master. */
function setParametroMaster(chiave, valore) {
  var foglio = _getFoglioParametriMaster();
  var righe  = foglio.getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (String(righe[i][0]) === chiave) {
      foglio.getRange(i + 1, 2).setValue(valore);
      return;
    }
  }
  foglio.appendRow([chiave, valore]);
}

/** Restituisce la API key CardTrader di default (chiave 'default_token'). */
function getTokenDiDefault() {
  return getParametroMaster('default_token');
}


// ════════════════════════════════════════════════════════════════════
// 3d. CREAZIONE DEL FOGLIO UTENTE (usata in fase di registrazione)
// ════════════════════════════════════════════════════════════════════
// Alla registrazione il foglio personale dell'utente viene creato dal
// codice (non più incollato a mano). Viene messo dentro una cartella
// Drive dedicata, creata una sola volta e poi riutilizzata.
// NOTA: usa DriveApp → richiede lo scope Drive. Al primo deploy lo
// script chiederà una nuova autorizzazione.
// ════════════════════════════════════════════════════════════════════

var NOME_CARTELLA_UTENTI = 'PokePortfolio - Utenti';

/**
 * Restituisce la cartella Drive che raccoglie i fogli utente, creandola
 * la prima volta. L'ID viene memorizzato nel master (cartella_utenti_id)
 * per riusarla nelle registrazioni successive.
 * @returns {Folder}
 */
function _getCartellaUtenti() {
  var idCartella = getParametroMaster('cartella_utenti_id');

  // Se l'ID è salvato, prova a riusare la cartella.
  if (idCartella) {
    try {
      return DriveApp.getFolderById(idCartella);
    } catch (e) {
      // La cartella non esiste più: la ricreo sotto.
    }
  }

  // Crea la cartella nella root del Drive e memorizza l'ID nel master.
  var cartella = DriveApp.createFolder(NOME_CARTELLA_UTENTI);
  setParametroMaster('cartella_utenti_id', cartella.getId());
  return cartella;
}

/**
 * Crea un nuovo Google Sheet per un utente, lo popola con i fogli
 * CONFIG, PORTFOLIO e PRICE_HISTORY (con intestazioni e default), lo
 * sposta nella cartella utenti e ne restituisce l'ID.
 *
 * @param {string} username - usato per il nome del file (PokePortfolio-<username>)
 * @returns {string} l'ID dello spreadsheet creato
 */
function creaFoglioUtente(username) {
  // 1. Crea lo spreadsheet.
  var spreadsheet = SpreadsheetApp.create('PokePortfolio-' + username);

  // 2. Crea i fogli con le intestazioni. NB: CACHE_CARDS e SET_CACHE NON
  //    vengono creati: il catalogo è centralizzato nel master.
  var strutturaFogli = {
    'CONFIG':        ['key', 'value'],
    'PORTFOLIO':     ['portfolio_id', 'card_id', 'quantity', 'condition',
                      'language', 'finish', 'date_added', 'blueprint_id',
                      'last_price'],
    'PRICE_HISTORY': ['timestamp', 'total_value']
  };

  for (var nomeFoglio in strutturaFogli) {
    if (!strutturaFogli.hasOwnProperty(nomeFoglio)) continue;
    var foglio = spreadsheet.insertSheet(nomeFoglio);
    foglio.appendRow(strutturaFogli[nomeFoglio]);
  }

  // 3. Rimuovi il foglio "Foglio1"/"Sheet1" creato di default.
  var foglioDefault = spreadsheet.getSheetByName('Foglio1') ||
                      spreadsheet.getSheetByName('Sheet1');
  if (foglioDefault) spreadsheet.deleteSheet(foglioDefault);

  // 4. Valori di default per CONFIG.
  var foglioConfig = spreadsheet.getSheetByName('CONFIG');
  foglioConfig.appendRow(['pokemontcg_api_key',       '']);
  foglioConfig.appendRow(['session_duration_hours',   24]);
  foglioConfig.appendRow(['portfolio_total_value',    '']);
  foglioConfig.appendRow(['portfolio_prices_updated', '']);

  // 5. Sposta il file nella cartella utenti.
  try {
    var file     = DriveApp.getFileById(spreadsheet.getId());
    var cartella = _getCartellaUtenti();
    cartella.addFile(file);
    DriveApp.getRootFolder().removeFile(file); // toglilo dalla root
  } catch (e) {
    Logger.log('[REGISTRA] Spostamento in cartella fallito: ' + e.message);
    // Non blocco: il foglio esiste comunque, resta nella root.
  }

  return spreadsheet.getId();
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

// ⚠️ NOTA: questa API key CardTrader NON è più usata dal codice.
// La key ora vive nella colonna D del master (una per utente). La lascio
// qui solo come riferimento da copiare manualmente nel master quando serve.
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
  // NOTA: CACHE_CARDS e SET_CACHE NON sono più qui: il catalogo è
  // centralizzato nel master (creato manualmente lì), non per-utente.
  var strutturaFogli = {
    'CONFIG':        ['key', 'value'],

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
  // NOTA: 'cardtrader_api_key' non sta più qui ma nella colonna D del
  // master (una per utente). Anche lo stato della sync del catalogo
  // ('last_catalog_sync') è centralizzato nel master (BATCH_STATE).
  var foglioConfig   = spreadsheet.getSheetByName('CONFIG');
  var chiaviEsistenti = foglioConfig.getDataRange().getValues()
    .map(function(riga) { return riga[0]; });

  var valoriDiDefault = [
    ['pokemontcg_api_key',       ''],
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