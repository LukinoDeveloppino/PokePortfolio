// ════════════════════════════════════════════════════════════════════
// Utils.gs — FUNZIONI DI UTILITÀ GENERALI
// ════════════════════════════════════════════════════════════════════

function formatDate(data) {
  if (!data) return '';
  return Utilities.formatDate(
    new Date(data), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'
  );
}

// Lancia 'UNAUTHORIZED' se il token non è valido. Va chiamata all'inizio
// di ogni funzione backend esposta al frontend.
function requireAuth(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
}

// Avvolge una funzione nell'envelope di errore standard
// { success: false, error: '...' }. Riduce il boilerplate try/catch
// ripetuto in ogni funzione pubblica.
function _wrapApiCall(fn) {
  try {
    return fn();
  } catch (e) {
    return e.message === 'UNAUTHORIZED'
      ? { success: false, error: 'UNAUTHORIZED' }
      : { success: false, error: e.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// ACCESSO AL MASTER (con cache per-esecuzione)
// ════════════════════════════════════════════════════════════════════

var _cacheMasterSpreadsheet = null;

// Restituisce (e mette in cache) il Google Sheet master.
// Evita di chiamare openById più volte nella stessa esecuzione.
function _getMasterSpreadsheet() {
  if (!_cacheMasterSpreadsheet) {
    _cacheMasterSpreadsheet = SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI);
  }
  return _cacheMasterSpreadsheet;
}

var _cacheBatchStateFoglio = null;

// Apre (creandolo se manca) il foglio BATCH_STATE nel master.
// Usato sia dalla sync del catalogo (Cards.gs) sia dal batch prezzi
// (Prices.gs) sia dai parametri globali (Code.gs): è lo stesso foglio.
function _getBatchStateFoglio() {
  if (!_cacheBatchStateFoglio) {
    var master = _getMasterSpreadsheet();
    _cacheBatchStateFoglio =
      master.getSheetByName('BATCH_STATE') || master.insertSheet('BATCH_STATE');
  }
  return _cacheBatchStateFoglio;
}


// ════════════════════════════════════════════════════════════════════
// HELPER FOGLIO CHIAVE→VALORE (colonna A = chiave, colonna B = valore)
// ════════════════════════════════════════════════════════════════════

// Restituisce l'oggetto { chiave: valore } per tutte le righe del foglio.
function _kvLeggiTutti(foglio) {
  var righe = foglio.getDataRange().getValues();
  var mappa = {};
  for (var i = 0; i < righe.length; i++) {
    if (righe[i][0]) mappa[String(righe[i][0])] = righe[i][1];
  }
  return mappa;
}

// Legge il valore di una chiave (null se assente).
function _kvLeggi(foglio, chiave) {
  var righe = foglio.getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (String(righe[i][0]) === String(chiave)) return righe[i][1];
  }
  return null;
}

// Scrive (o aggiorna) una coppia chiave→valore.
function _kvScrivi(foglio, chiave, valore) {
  var righe = foglio.getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (String(righe[i][0]) === String(chiave)) {
      foglio.getRange(i + 1, 2).setValue(valore);
      return;
    }
  }
  foglio.appendRow([chiave, valore]);
}

// Scrive più coppie chiave→valore in una sola lettura del foglio.
function _kvScriviMulti(foglio, oggetto) {
  var righe = foglio.getDataRange().getValues();
  var nuove = [];

  Object.keys(oggetto).forEach(function(chiave) {
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === String(chiave)) {
        foglio.getRange(i + 1, 2).setValue(oggetto[chiave]);
        return; // esce solo dal callback forEach
      }
    }
    nuove.push([chiave, oggetto[chiave]]);
  });

  nuove.forEach(function(riga) { foglio.appendRow(riga); });
}


// ════════════════════════════════════════════════════════════════════
// HELPER TRIGGER ONE-SHOT
// ════════════════════════════════════════════════════════════════════

// Cancella tutti i trigger del progetto che puntano a nomeFunzione.
// I trigger after() non si auto-rimuovono: senza pulizia si accumulano.
function _pulisciTrigger(nomeFunzione) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === nomeFunzione) ScriptApp.deleteTrigger(t);
  });
}

// Rimuove eventuali duplicati e crea un nuovo trigger one-shot.
function _programmaTrigger(nomeFunzione, ritardoMs) {
  _pulisciTrigger(nomeFunzione);
  ScriptApp.newTrigger(nomeFunzione).timeBased().after(ritardoMs).create();
  Logger.log('[TRIGGER] ' + nomeFunzione + ' programmato tra ' + (ritardoMs / 1000) + 's');
}


// ════════════════════════════════════════════════════════════════════
// ALTRI HELPER
// ════════════════════════════════════════════════════════════════════

// Restituisce l'indice della prima riga di dati (salta l'intestazione
// se la cella A1 contiene chiaveHeader).
function _primaRigaDati(righe, chiaveHeader) {
  return (righe.length > 0 && String(righe[0][0]) === chiaveHeader) ? 1 : 0;
}
