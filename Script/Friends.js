// ════════════════════════════════════════════════════════════════════
// Friends.gs — SEZIONE AMICI (sola lettura dei portfolio altrui)
// ════════════════════════════════════════════════════════════════════
// Prima di aprire lo sheet di un altro utente verifica che il suo
// sheet_id sia registrato nel master (sicurezza contro ID arbitrari).
// ════════════════════════════════════════════════════════════════════

function getFriends(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var mioUsername = getSessionUsername(token);
    var righeMaster = getMasterSheet().getDataRange().getValues();

    var listaAmici = [];
    for (var i = 0; i < righeMaster.length; i++) {
      var username = String(righeMaster[i][0] || '').trim();
      var sheetId  = String(righeMaster[i][2] || '').trim();

      if (!username || !sheetId) continue;
      if (username.toLowerCase() === mioUsername.toLowerCase()) continue;

      listaAmici.push({ username: username, sheet_id: sheetId });
    }

    return { success: true, items: listaAmici };
  });
}


function getFriendPortfolio(token, sheetId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    if (!sheetId) return { success: false, error: 'Sheet ID mancante.' };

    // Verifica che lo sheet appartenga a un utente registrato nel master.
    var righeMaster     = getMasterSheet().getDataRange().getValues();
    var sheetRegistrato = righeMaster.some(function(riga) {
      return String(riga[2]).trim() === sheetId.trim();
    });
    if (!sheetRegistrato) return { success: false, error: 'Utente non trovato nel sistema.' };

    // Apri lo spreadsheet dell'amico.
    var spreadsheetAmico;
    try {
      spreadsheetAmico = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      return { success: false, error: 'Impossibile accedere allo sheet.' };
    }

    var foglioPortfolioAmico = spreadsheetAmico.getSheetByName('PORTFOLIO');
    if (!foglioPortfolioAmico) return { success: false, error: 'Foglio PORTFOLIO non trovato.' };

    var ultimaRiga = foglioPortfolioAmico.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [], cards: {} };

    var righe          = foglioPortfolioAmico.getRange(1, 1, ultimaRiga, 9).getValues();
    var rigaDiPartenza = _primaRigaDati(righe, 'portfolio_id');

    var vociPortfolio = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      vociPortfolio.push(convertiRigaInVocePortfolio(righe[i]));
    }

    // Recupera i metadati delle carte dalla cache condivisa.
    var idCarteDaCercare = {};
    vociPortfolio.forEach(function(voce) { idCarteDaCercare[voce.card_id] = true; });

    var righeCarte = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCarte = {};
    for (var j = 1; j < righeCarte.length; j++) {
      if (righeCarte[j][0] && idCarteDaCercare[righeCarte[j][0]]) {
        mappaCarte[righeCarte[j][0]] = convertiRigaInCarta(righeCarte[j]);
      }
    }

    return { success: true, items: vociPortfolio, cards: mappaCarte };
  });
}
