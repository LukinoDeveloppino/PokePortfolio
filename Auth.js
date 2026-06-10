// ============================================================
// Auth.gs — Login, registrazione e gestione sessioni multi-utente
// ============================================================
// Il foglio MASTER (ID hardcodato in MASTER_SHEET_ID) contiene:
//   colonna A: username
//   colonna B: password_hash (SHA-256 hex)
//   colonna C: sheet_id (Google Sheet personale dell'utente)
// ============================================================

var MASTER_SHEET_ID = '1r7PKo6WIzd1M_PgR7LOhwn4cFk8Xec-s4IGIA6Qyz-k';

// ---- Helper foglio master ----

function getMasterSheet() {
  try {
    var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    var sheet = ss.getSheets()[0]; // primo foglio del master
    return sheet;
  } catch (e) {
    throw new Error('Impossibile aprire il foglio master utenti: ' + e.message);
  }
}

// ---- SHA-256 hex (riusa Utilities di GAS) ----

function sha256hex(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ---- Registrazione ----
// Crea una nuova riga nel foglio master.
// Restituisce errore se lo username è già in uso.

function register(username, password, sheetId) {
  try {
    if (!username || !password || !sheetId) {
      return { success: false, error: 'Tutti i campi sono obbligatori.' };
    }

    username = username.trim();
    sheetId  = sheetId.trim();

    if (username.length < 3) {
      return { success: false, error: 'Il nome utente deve avere almeno 3 caratteri.' };
    }

    // Verifica che lo sheet_id sia accessibile prima di salvarlo
    try {
      SpreadsheetApp.openById(sheetId);
    } catch (ex) {
      return { success: false, error: 'Sheet ID non valido o non accessibile. Assicurati che il foglio sia condiviso con il service account.' };
    }

    var master = getMasterSheet();
    var data   = master.getDataRange().getValues();

    // Controlla duplicati username (case-insensitive)
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        return { success: false, error: 'Nome utente già in uso.' };
      }
    }

    var hash = sha256hex(password);
    master.appendRow([username, hash, sheetId]);

    return { success: true };
  } catch (e) {
    return { success: false, error: 'Errore durante la registrazione: ' + e.message };
  }
}

// ---- Login ----
// Verifica username + password nel foglio master.
// In caso di successo salva token + username + sheet_id in UserProperties.

function login(username, password) {
  try {
    if (!username || !password) {
      return { success: false, error: 'Inserisci nome utente e password.' };
    }

    username = username.trim();

    var master = getMasterSheet();
    var data   = master.getDataRange().getValues();
    var hash   = sha256hex(password);

    var found = null;
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        found = { username: String(data[i][0]), storedHash: String(data[i][1]), sheetId: String(data[i][2]) };
        break;
      }
    }

    if (!found) {
      return { success: false, error: 'Nome utente o password errati.' };
    }

    if (found.storedHash !== hash) {
      return { success: false, error: 'Nome utente o password errati.' };
    }

    if (!found.sheetId) {
      return { success: false, error: 'Account non configurato correttamente (sheet_id mancante).' };
    }

    var sessionToken = Utilities.getUuid();
    var expiresAt    = new Date().getTime() + (24 * 60 * 60 * 1000); // 24 ore

    var props = PropertiesService.getUserProperties();
    props.setProperty('session_token',    sessionToken);
    props.setProperty('session_expires',  String(expiresAt));
    props.setProperty('session_username', found.username);
    props.setProperty('session_sheet_id', found.sheetId);

    return { success: true, token: sessionToken, username: found.username };
  } catch (e) {
    return { success: false, error: 'Errore durante il login: ' + e.message };
  }
}

// ---- Validazione sessione ----

function validateSession(token) {
  try {
    if (!token) return false;
    var props       = PropertiesService.getUserProperties();
    var storedToken = props.getProperty('session_token');
    var expiresAt   = parseInt(props.getProperty('session_expires') || '0', 10);

    if (token !== storedToken) return false;
    if (new Date().getTime() > expiresAt) {
      props.deleteProperty('session_token');
      props.deleteProperty('session_expires');
      props.deleteProperty('session_username');
      props.deleteProperty('session_sheet_id');
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ---- Recupera sheet_id dalla sessione attiva ----

function getSessionSheetId(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
  var props = PropertiesService.getUserProperties();
  var sheetId = props.getProperty('session_sheet_id');
  if (!sheetId) throw new Error('UNAUTHORIZED');
  return sheetId;
}

// ---- Recupera username dalla sessione attiva ----

function getSessionUsername(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
  var props = PropertiesService.getUserProperties();
  return props.getProperty('session_username') || '';
}

// ---- Logout ----

function logout(token) {
  try {
    var props = PropertiesService.getUserProperties();
    props.deleteProperty('session_token');
    props.deleteProperty('session_expires');
    props.deleteProperty('session_username');
    props.deleteProperty('session_sheet_id');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---- Check sessione (chiamata dal frontend all'avvio) ----

function checkSession(token) {
  if (!validateSession(token)) return { valid: false };
  var props = PropertiesService.getUserProperties();
  return {
    valid:    true,
    username: props.getProperty('session_username') || ''
  };
}
