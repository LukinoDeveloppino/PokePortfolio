// ============================================================
// Auth.gs — Login, registrazione, sessioni multi-utente
// ============================================================
// Il foglio MASTER (ID hardcodato) contiene:
//   col A: username
//   col B: password_hash (SHA-256 hex)
//   col C: sheet_id (Google Sheet personale dell'utente)
// ============================================================

var MASTER_SHEET_ID = '1r7PKo6WIzd1M_PgR7LOhwn4cFk8Xec-s4IGIA6Qyz-k';

// ---- Apre il primo foglio del master ----
function getMasterSheet() {
  try {
    return SpreadsheetApp.openById(MASTER_SHEET_ID).getSheets()[0];
  } catch (e) {
    throw new Error('Impossibile aprire il foglio master: ' + e.message);
  }
}

// ---- SHA-256 hex ----
function sha256hex(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ---- Registrazione ----
function register(username, password, sheetId) {
  try {
    if (!username || !password || !sheetId) return { success: false, error: 'Tutti i campi sono obbligatori.' };

    username = username.trim();
    sheetId  = sheetId.trim();

    if (username.length < 3) return { success: false, error: 'Il nome utente deve avere almeno 3 caratteri.' };

    // Verifica che lo sheet sia accessibile prima di salvarlo
    try { SpreadsheetApp.openById(sheetId); }
    catch (ex) { return { success: false, error: 'Sheet ID non valido o non accessibile.' }; }

    var master = getMasterSheet();
    var data   = master.getDataRange().getValues();

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        return { success: false, error: 'Nome utente già in uso.' };
      }
    }

    master.appendRow([username, sha256hex(password), sheetId]);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Errore durante la registrazione: ' + e.message };
  }
}

// ---- Login ----
// In caso di successo, salva token + username + sheet_id in UserProperties (24 ore)
function login(username, password) {
  try {
    if (!username || !password) return { success: false, error: 'Inserisci nome utente e password.' };

    username = username.trim();
    var master = getMasterSheet();
    var data   = master.getDataRange().getValues();
    var hash   = sha256hex(password);
    var found  = null;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        found = { username: String(data[i][0]), hash: String(data[i][1]), sheetId: String(data[i][2]) };
        break;
      }
    }

    if (!found || found.hash !== hash) return { success: false, error: 'Nome utente o password errati.' };
    if (!found.sheetId) return { success: false, error: 'Account non configurato correttamente.' };

    var token     = Utilities.getUuid();
    var expiresAt = new Date().getTime() + (24 * 60 * 60 * 1000);
    var props     = PropertiesService.getUserProperties();

    props.setProperty('session_token',    token);
    props.setProperty('session_expires',  String(expiresAt));
    props.setProperty('session_username', found.username);
    props.setProperty('session_sheet_id', found.sheetId);

    return { success: true, token: token, username: found.username };
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
      // Sessione scaduta: pulisce le proprietà
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

// ---- Recupera username dalla sessione ----
function getSessionUsername(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
  return PropertiesService.getUserProperties().getProperty('session_username') || '';
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
  return {
    valid:    true,
    username: PropertiesService.getUserProperties().getProperty('session_username') || ''
  };
}
