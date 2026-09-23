// ════════════════════════════════════════════════════════════════════
// Setup.gs — CONFIGURAZIONE GUIDATA DI UNA NUOVA INSTALLAZIONE
// ════════════════════════════════════════════════════════════════════
// Nessun ID è scritto nel codice: l'ID del foglio master vive nelle
// Proprietà script del progetto, così chiunque copi il progetto ottiene
// un'installazione indipendente.
//
// Finché l'app non è configurata, doGet (Code.gs) serve la pagina
// setup.html invece dell'app. Dalla pagina il proprietario può:
//   • creare da zero il foglio master, il primo account, i trigger e
//     avviare la prima sincronizzazione del catalogo (eseguiSetup);
//   • collegare un foglio master già esistente (collegaMasterEsistente).
//
// Proprietà script:
//   MASTER_SHEET_ID   ID del Google Sheet master
//   SETUP_OWNER       email dell'account che ha configurato l'app. Se il
//                     progetto viene copiato da un altro account le
//                     proprietà potrebbero seguirlo: il confronto con
//                     l'utente effettivo fa ripartire il setup invece di
//                     puntare al master di qualcun altro.
// ════════════════════════════════════════════════════════════════════

// Nomi (chiavi) delle Proprietà script, NON i valori: i valori li scrive
// _salvaConfigurazione quando si completa il setup.
var PROP_ID_MASTER    = 'MASTER_SHEET_ID';
var PROP_PROPRIETARIO = 'SETUP_OWNER';

var NOME_FOGLIO_MASTER = 'PokePortfolio - Master';

// Orari dei trigger giornalieri creati dal setup (fuso del progetto).
var ORA_TRIGGER_PREZZI = 3;
var ORA_TRIGGER_SYNC   = 5;


// ════════════════════════════════════════════════════════════════════
// STATO DELLA CONFIGURAZIONE
// ════════════════════════════════════════════════════════════════════

function getIdFoglioMaster() {
  return PropertiesService.getScriptProperties().getProperty(PROP_ID_MASTER) || '';
}

function _emailProprietario() {
  return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

function isAppConfigurata() {
  var proprieta = PropertiesService.getScriptProperties();
  var proprietarioSalvato = String(proprieta.getProperty(PROP_PROPRIETARIO) || '').toLowerCase();
  return !!proprieta.getProperty(PROP_ID_MASTER) &&
         !!proprietarioSalvato && proprietarioSalvato === _emailProprietario();
}

// La web app gira "come me" (il proprietario): solo quando anche chi la
// visita è il proprietario le due email coincidono. Per chiunque altro
// getActiveUser() è vuoto o diverso, quindi non può configurarla.
function _visitatoreEProprietario() {
  var attivo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!attivo && attivo === _emailProprietario();
}

function getStatoSetup() {
  return {
    configurata:   isAppConfigurata(),
    puoConfigurare: _visitatoreEProprietario(),
    email:         _emailProprietario(),
    app_url:       ScriptApp.getService().getUrl()
  };
}


// ════════════════════════════════════════════════════════════════════
// NUOVA INSTALLAZIONE
// ════════════════════════════════════════════════════════════════════

function eseguiSetup(dati) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return { success: false, error: 'Configurazione già in corso.' };

  try {
    var controllo = _controllaPermessoSetup();
    if (controllo) return controllo;

    dati = dati || {};
    var username = String(dati.username || '').trim();
    var password = String(dati.password || '');
    var apiKey   = String(dati.apiKey || '').trim();

    if (username.length < 3) return { success: false, error: 'Il nome utente deve avere almeno 3 caratteri.' };
    if (password.length < 6) return { success: false, error: 'La password deve avere almeno 6 caratteri.' };
    if (!apiKey)             return { success: false, error: "L'API key di CardTrader è obbligatoria." };

    var esitoKey = _verificaApiKeyCardTrader(apiKey);
    if (esitoKey === 'non_valida') {
      return { success: false, error: 'CardTrader ha rifiutato questa API key: controlla di averla copiata per intero.' };
    }

    // ---- 1. Foglio master con i fogli che l'app si aspetta ----
    // Il primo foglio è l'elenco utenti e resta SENZA intestazione: login
    // e amici leggono tutte le righe come utenti.
    var master = SpreadsheetApp.create(NOME_FOGLIO_MASTER);
    master.getSheets()[0].setName('UTENTI');
    ['SET_CACHE', 'CACHE_CARDS', 'BATCH_STATE'].forEach(function(nome) { master.insertSheet(nome); });

    _salvaConfigurazione(master.getId());
    setParametroMaster('default_token', apiKey);

    // ---- 2. Trigger giornalieri + prima sincronizzazione del catalogo ----
    // Prima dell'account: se la registrazione fallisse, l'app è comunque
    // configurata e completa, e l'account si crea dalla pagina di accesso.
    _assicuraTriggerGiornalieri();
    _avviaPrimaSync();

    // ---- 3. Primo account (l'amministratore) ----
    var esitoRegistrazione = register(username, password, apiKey);
    if (!esitoRegistrazione.success) {
      return { success: false, error: 'App configurata, ma la creazione dell\'account è fallita (' +
                                      esitoRegistrazione.error + '). Apri il link dell\'app e registrati dalla pagina di accesso.' };
    }

    Logger.log('[SETUP] Nuova installazione completata per ' + _emailProprietario());
    return {
      success:        true,
      app_url:        ScriptApp.getService().getUrl(),
      master_url:     master.getUrl(),
      key_verificata: esitoKey === 'valida'
    };

  } catch (errore) {
    return { success: false, error: 'Errore durante la configurazione: ' + errore.message };
  } finally {
    lock.releaseLock();
  }
}


// ════════════════════════════════════════════════════════════════════
// COLLEGAMENTO A UN MASTER ESISTENTE (es. dopo un aggiornamento)
// ════════════════════════════════════════════════════════════════════

function collegaMasterEsistente(idOUrl) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return { success: false, error: 'Configurazione già in corso.' };

  try {
    var controllo = _controllaPermessoSetup();
    if (controllo) return controllo;

    var id = _estraiIdFoglio(idOUrl);
    if (!id) return { success: false, error: 'Incolla il link o l\'ID del foglio master.' };

    var master;
    try {
      master = SpreadsheetApp.openById(id);
    } catch (e) {
      return { success: false, error: 'Non riesco ad aprire il foglio: controlla il link e che appartenga a questo account.' };
    }

    // Aggiungo i fogli mancanti senza toccare quelli esistenti.
    ['SET_CACHE', 'CACHE_CARDS', 'BATCH_STATE'].forEach(function(nome) {
      if (!master.getSheetByName(nome)) master.insertSheet(nome);
    });

    _salvaConfigurazione(id);
    _assicuraTriggerGiornalieri();
    if (master.getSheetByName('SET_CACHE').getLastRow() <= 1) _avviaPrimaSync();

    Logger.log('[SETUP] Collegato master esistente ' + id);
    return { success: true, app_url: ScriptApp.getService().getUrl(), master_url: master.getUrl() };

  } catch (errore) {
    return { success: false, error: 'Errore durante il collegamento: ' + errore.message };
  } finally {
    lock.releaseLock();
  }
}


// ════════════════════════════════════════════════════════════════════
// HELPER
// ════════════════════════════════════════════════════════════════════

// null se il setup è permesso, altrimenti l'envelope di errore.
function _controllaPermessoSetup() {
  if (isAppConfigurata()) return { success: false, error: "L'app è già configurata." };
  if (!_visitatoreEProprietario()) {
    return { success: false, error: 'Solo il proprietario del progetto Apps Script può configurare l\'app.' };
  }
  return null;
}

function _salvaConfigurazione(idMaster) {
  var proprieta = {};
  proprieta[PROP_ID_MASTER]    = idMaster;
  proprieta[PROP_PROPRIETARIO] = _emailProprietario();
  PropertiesService.getScriptProperties().setProperties(proprieta);
  // Le cache per-esecuzione di Utils.gs potrebbero puntare al vecchio master.
  _cacheMasterSpreadsheet = null;
  _cacheBatchStateFoglio  = null;
}

// Accetta sia l'ID puro sia il link completo del foglio.
function _estraiIdFoglio(testo) {
  testo = String(testo || '').trim();
  var daUrl = testo.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (daUrl) return daUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(testo) ? testo : '';
}

// 'valida' | 'non_valida' | 'sconosciuto' (CardTrader irraggiungibile:
// non blocco il setup per un problema di rete temporaneo).
function _verificaApiKeyCardTrader(apiKey) {
  try {
    var risposta = UrlFetchApp.fetch(URL_BASE_API_CARDTRADER + '/info', {
      headers: headerAutenticazioneCardTrader(apiKey),
      muteHttpExceptions: true
    });
    var codice = risposta.getResponseCode();
    if (codice === 200) return 'valida';
    if (codice === 401 || codice === 403) return 'non_valida';
    return 'sconosciuto';
  } catch (e) {
    return 'sconosciuto';
  }
}

// Crea i trigger giornalieri solo se mancano: un'installazione esistente
// che si ricollega mantiene i propri orari.
function _assicuraTriggerGiornalieri() {
  var esistenti = {};
  ScriptApp.getProjectTriggers().forEach(function(t) { esistenti[t.getHandlerFunction()] = true; });

  if (!esistenti['updateAllUsersAllPrices']) {
    ScriptApp.newTrigger('updateAllUsersAllPrices').timeBased().everyDays(1).atHour(ORA_TRIGGER_PREZZI).create();
  }
  if (!esistenti['syncCatalog']) {
    ScriptApp.newTrigger('syncCatalog').timeBased().everyDays(1).atHour(ORA_TRIGGER_SYNC).create();
  }
}

// La prima sync scarica centinaia di set: la lancio a turni tramite il
// worker (vedi Cards.gs) invece di bloccare la risposta al browser.
// Non uso _programmaTrigger('syncCatalog') perché cancellerebbe il
// trigger giornaliero appena creato.
function _avviaPrimaSync() {
  _kvScriviMulti(_getBatchStateFoglio(), {
    catalog_running:     'true',
    catalog_cursor:      '',
    catalog_mode:        '',
    catalog_run_started: formatDate(new Date())
  });
  _programmaTrigger(SYNC_FUNZIONE_WORKER, 5 * 1000);
}
