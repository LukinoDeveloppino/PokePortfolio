// ════════════════════════════════════════════════════════════════════
// Auth.gs — LOGIN, REGISTRAZIONE E SESSIONI (multi-utente)
// ════════════════════════════════════════════════════════════════════
// Come funziona l'autenticazione:
//
// • Esiste un Google Sheet "MASTER" (condiviso, ID fisso qui sotto) che
//   contiene l'elenco di tutti gli utenti registrati:
//     colonna A: username
//     colonna B: hash SHA-256 della password (mai la password in chiaro)
//     colonna C: ID del Google Sheet personale dell'utente
//     colonna D: API key CardTrader dell'utente (impostata in fase di
//                registrazione; se l'utente non la fornisce viene usato il
//                token di default letto da BATCH_STATE del master)
//
// • Al login, se username+password sono corretti, viene generato un token
//   casuale (UUID) e salvato — insieme a username, sheet_id e scadenza —
//   in PropertiesService.getUserProperties().
//
// • Ad ogni chiamata successiva il frontend invia il token, e il backend
//   lo confronta con quello salvato (vedi validateSession).
//
// • La sessione dura 24 ore, poi scade e l'utente deve rifare il login.
// ════════════════════════════════════════════════════════════════════

// ID del Google Sheet master con l'elenco degli utenti registrati.
var ID_FOGLIO_MASTER_UTENTI = '1r7PKo6WIzd1M_PgR7LOhwn4cFk8Xec-s4IGIA6Qyz-k';

// Durata della sessione in millisecondi (24 ore).
var DURATA_SESSIONE_MS = 24 * 60 * 60 * 1000;

// Nomi delle proprietà di sessione salvate in UserProperties.
// Tenerli in un unico posto evita errori di battitura sparsi nel codice.
var CHIAVI_SESSIONE = ['session_token', 'session_expires', 'session_username', 'session_sheet_id'];


// ════════════════════════════════════════════════════════════════════
// HELPER INTERNI
// ════════════════════════════════════════════════════════════════════

/**
 * Apre il primo foglio dello spreadsheet master (quello con l'elenco utenti).
 * Usato anche da Friends.gs e Prices.gs.
 */
function getMasterSheet() {
  try {
    return SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI).getSheets()[0];
  } catch (errore) {
    throw new Error('Impossibile aprire il foglio master: ' + errore.message);
  }
}

/**
 * Calcola l'hash SHA-256 di un testo e lo restituisce come stringa
 * esadecimale (64 caratteri). Usato per non salvare mai password in chiaro.
 */
function sha256hex(testo) {
  var byteArray = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    testo,
    Utilities.Charset.UTF_8
  );

  // computeDigest restituisce byte con segno (-128..127):
  // qui li convertiamo in esadecimale a due cifre (00..ff).
  return byteArray.map(function(byte) {
    var esadecimale = (byte < 0 ? byte + 256 : byte).toString(16);
    return esadecimale.length === 1 ? '0' + esadecimale : esadecimale;
  }).join('');
}

/**
 * Cancella tutte le proprietà di sessione (logout / sessione scaduta).
 */
function cancellaSessione() {
  var proprietaUtente = PropertiesService.getUserProperties();
  CHIAVI_SESSIONE.forEach(function(chiave) {
    proprietaUtente.deleteProperty(chiave);
  });
}


// ════════════════════════════════════════════════════════════════════
// REGISTRAZIONE
// ════════════════════════════════════════════════════════════════════

/**
 * Registra un nuovo utente. L'utente fornisce solo username e password
 * (più, facoltativamente, la propria API key CardTrader). Il foglio
 * personale viene CREATO dal server, popolato e salvato; il suo ID viene
 * scritto nel master accanto all'utente.
 *
 * Riga scritta nel master: [username, hash, sheetId, apiKey].
 * Se l'API key è vuota, viene usato il token di default (chiave
 * 'default_token' nel foglio BATCH_STATE del master).
 *
 * @param {string} username          - nome utente scelto (minimo 3 caratteri)
 * @param {string} password          - password in chiaro (salvata solo come hash)
 * @param {string} [cardtraderApiKey] - API key CardTrader (facoltativa)
 * @returns {{success:boolean, error?:string}}
 */
function register(username, password, cardtraderApiKey) {
  try {
    if (!username || !password) {
      return { success: false, error: 'Nome utente e password sono obbligatori.' };
    }

    username = username.trim();
    var apiKey = (cardtraderApiKey || '').trim();

    if (username.length < 3) {
      return { success: false, error: 'Il nome utente deve avere almeno 3 caratteri.' };
    }

    var foglioMaster = getMasterSheet();
    var righeUtenti  = foglioMaster.getDataRange().getValues();

    // Username univoco (confronto case-insensitive). Controllo PRIMA di
    // creare cartella/foglio, così non restano fogli orfani.
    for (var i = 0; i < righeUtenti.length; i++) {
      if (String(righeUtenti[i][0]).toLowerCase() === username.toLowerCase()) {
        return { success: false, error: 'Nome utente già in uso.' };
      }
    }

    // Se l'utente non ha fornito una key, usa il token di default dal master.
    if (!apiKey) {
      apiKey = getTokenDiDefault();
    }

    // Crea il foglio personale dell'utente (CONFIG, PORTFOLIO, PRICE_HISTORY).
    var sheetId;
    try {
      sheetId = creaFoglioUtente(username);
    } catch (erroreCreazione) {
      return { success: false, error: 'Impossibile creare il foglio utente: ' + erroreCreazione.message };
    }

    // Scrivi la riga nel master: [username, hash, sheetId, apiKey].
    foglioMaster.appendRow([username, sha256hex(password), sheetId, apiKey]);
    return { success: true };

  } catch (errore) {
    return { success: false, error: 'Errore durante la registrazione: ' + errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════════

/**
 * Esegue il login. Se username e password corrispondono a un utente del
 * master, crea una nuova sessione di 24 ore e restituisce il token al
 * frontend (che lo salverà in sessionStorage).
 *
 * @returns {{success:boolean, token?:string, username?:string, error?:string}}
 */
function login(username, password) {
  try {
    if (!username || !password) {
      return { success: false, error: 'Inserisci nome utente e password.' };
    }

    username = username.trim();

    var righeUtenti      = getMasterSheet().getDataRange().getValues();
    var hashPasswordData = sha256hex(password);
    var utenteTrovato    = null;

    // Cerca l'utente per username (case-insensitive).
    for (var i = 0; i < righeUtenti.length; i++) {
      if (String(righeUtenti[i][0]).toLowerCase() === username.toLowerCase()) {
        utenteTrovato = {
          username: String(righeUtenti[i][0]),
          hash:     String(righeUtenti[i][1]),
          sheetId:  String(righeUtenti[i][2])
        };
        break;
      }
    }

    // Utente inesistente o password sbagliata → stesso messaggio generico
    // (non rivelare quale dei due è sbagliato).
    if (!utenteTrovato || utenteTrovato.hash !== hashPasswordData) {
      return { success: false, error: 'Nome utente o password errati.' };
    }
    if (!utenteTrovato.sheetId) {
      return { success: false, error: 'Account non configurato correttamente.' };
    }

    // ---- Crea la sessione ----
    var nuovoToken      = Utilities.getUuid();
    var scadenzaInMs    = new Date().getTime() + DURATA_SESSIONE_MS;
    var proprietaUtente = PropertiesService.getUserProperties();

    proprietaUtente.setProperty('session_token',    nuovoToken);
    proprietaUtente.setProperty('session_expires',  String(scadenzaInMs));
    proprietaUtente.setProperty('session_username', utenteTrovato.username);
    proprietaUtente.setProperty('session_sheet_id', utenteTrovato.sheetId);

    return { success: true, token: nuovoToken, username: utenteTrovato.username };

  } catch (errore) {
    return { success: false, error: 'Errore durante il login: ' + errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// VALIDAZIONE / CONTROLLO SESSIONE
// ════════════════════════════════════════════════════════════════════

/**
 * Verifica se un token di sessione è valido:
 *   1. deve coincidere con quello salvato in UserProperties
 *   2. la sessione non deve essere scaduta
 * Se la sessione è scaduta, la pulisce automaticamente.
 *
 * @returns {boolean} true = sessione valida
 */
function validateSession(token) {
  try {
    if (!token) return false;

    var proprietaUtente = PropertiesService.getUserProperties();
    var tokenSalvato    = proprietaUtente.getProperty('session_token');
    var scadenzaInMs    = parseInt(proprietaUtente.getProperty('session_expires') || '0', 10);

    if (token !== tokenSalvato) return false;

    if (new Date().getTime() > scadenzaInMs) {
      cancellaSessione(); // sessione scaduta: pulisce le proprietà
      return false;
    }

    return true;
  } catch (errore) {
    return false;
  }
}

/**
 * Restituisce lo username dell'utente loggato.
 * Lancia 'UNAUTHORIZED' se la sessione non è valida.
 */
function getSessionUsername(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
  return PropertiesService.getUserProperties().getProperty('session_username') || '';
}

/**
 * Chiamata dal frontend all'avvio della pagina: controlla se il token
 * salvato in sessionStorage è ancora valido, e in caso positivo restituisce
 * anche lo username (per mostrarlo nell'interfaccia).
 */
function checkSession(token) {
  if (!validateSession(token)) return { valid: false };
  return {
    valid:    true,
    username: PropertiesService.getUserProperties().getProperty('session_username') || ''
  };
}


// ════════════════════════════════════════════════════════════════════
// LOGOUT
// ════════════════════════════════════════════════════════════════════

/**
 * Termina la sessione cancellando tutte le proprietà salvate.
 */
function logout(token) {
  try {
    cancellaSessione();
    return { success: true };
  } catch (errore) {
    return { success: false, error: errore.message };
  }
}