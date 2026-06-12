// ════════════════════════════════════════════════════════════════════
// Friends.gs — SEZIONE AMICI (sola lettura dei portfolio altrui)
// ════════════════════════════════════════════════════════════════════
// La sezione Amici mostra l'elenco di tutti gli altri utenti registrati
// nel foglio master (vedi Auth.gs) e permette di vedere — in sola
// lettura — il portfolio di ciascuno.
//
// Sicurezza: prima di aprire lo sheet di un altro utente verifichiamo
// che il suo sheet_id sia effettivamente registrato nel master.
// ════════════════════════════════════════════════════════════════════


/**
 * Restituisce la lista degli ALTRI utenti registrati (escluso chi chiama).
 * Per ognuno: username e sheet_id (necessario per aprirne il portfolio).
 */
function getFriends(token) {
  try {
    requireAuth(token);

    var mioUsername = getSessionUsername(token);
    var righeMaster = getMasterSheet().getDataRange().getValues();

    var listaAmici = [];
    for (var i = 0; i < righeMaster.length; i++) {
      var username = String(righeMaster[i][0] || '').trim(); // colonna A
      var sheetId  = String(righeMaster[i][2] || '').trim(); // colonna C

      if (!username || !sheetId) continue;                   // riga incompleta
      if (username.toLowerCase() === mioUsername.toLowerCase()) continue; // escludi me stesso

      listaAmici.push({ username: username, sheet_id: sheetId });
    }

    return { success: true, items: listaAmici };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


/**
 * Restituisce il portfolio di un amico (sola lettura) più i metadati delle
 * sue carte, presi dalla MIA cache locale (CACHE_CARDS).
 *
 * @param {string} token   - token di sessione di chi chiede
 * @param {string} sheetId - ID dello sheet dell'amico (da getFriends)
 * @returns {{success:boolean, items?:Array, cards?:Object, error?:string}}
 *   items = voci del portfolio dell'amico
 *   cards = mappa card_id → dati carta (per nome, immagine, set...)
 */
function getFriendPortfolio(token, sheetId) {
  try {
    requireAuth(token);

    if (!sheetId) return { success: false, error: 'Sheet ID mancante.' };

    // ---- 1. Sicurezza: lo sheet richiesto deve appartenere a un utente
    //         registrato nel master (impedisce di aprire sheet arbitrari) ----
    var righeMaster = getMasterSheet().getDataRange().getValues();
    var sheetRegistrato = false;
    for (var m = 0; m < righeMaster.length; m++) {
      if (String(righeMaster[m][2]).trim() === sheetId.trim()) {
        sheetRegistrato = true;
        break;
      }
    }
    if (!sheetRegistrato) {
      return { success: false, error: 'Utente non trovato nel sistema.' };
    }

    // ---- 2. Apri lo spreadsheet dell'amico ----
    var spreadsheetAmico;
    try {
      spreadsheetAmico = SpreadsheetApp.openById(sheetId);
    } catch (erroreApertura) {
      return { success: false, error: 'Impossibile accedere allo sheet.' };
    }

    var foglioPortfolioAmico = spreadsheetAmico.getSheetByName('PORTFOLIO');
    if (!foglioPortfolioAmico) {
      return { success: false, error: 'Foglio PORTFOLIO non trovato.' };
    }

    // ---- 3. Leggi le voci del portfolio dell'amico ----
    var ultimaRiga = foglioPortfolioAmico.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [], cards: {} };

    var righe = foglioPortfolioAmico.getRange(1, 1, ultimaRiga, 9).getValues();
    var rigaDiPartenza = (righe[0][0] === 'portfolio_id') ? 1 : 0; // salta intestazione

    var vociPortfolio = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      // Stessa struttura del mio portfolio: riuso il parser di Portfolio.gs.
      vociPortfolio.push(convertiRigaInVocePortfolio(righe[i]));
    }

    // ---- 4. Per ogni carta posseduta dall'amico, recupera i metadati
    //         (nome, immagine, set...) dalla MIA cache CACHE_CARDS ----
    var idCarteDaCercare = {};
    vociPortfolio.forEach(function(voce) { idCarteDaCercare[voce.card_id] = true; });

    var righeCarte = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCarte = {};

    for (var j = 1; j < righeCarte.length; j++) {
      var rigaCarta = righeCarte[j];
      if (rigaCarta[0] && idCarteDaCercare[rigaCarta[0]]) {
        mappaCarte[rigaCarta[0]] = {
          id:              String(rigaCarta[0]),
          name:            String(rigaCarta[1]),
          set_id:          String(rigaCarta[2]),
          set_name:        String(rigaCarta[3]),
          set_series:      String(rigaCarta[4]),
          number:          String(rigaCarta[5]),
          rarity:          String(rigaCarta[6]),
          types:           String(rigaCarta[7]),
          image_url_small: String(rigaCarta[8]),
          image_url_large: String(rigaCarta[9]),
          set_logo_url:    String(rigaCarta[10])
        };
      }
    }

    return { success: true, items: vociPortfolio, cards: mappaCarte };

  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}
