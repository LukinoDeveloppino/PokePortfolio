 // ============================================================
// Friends.gs — Gestione amici e lettura portfolio esterno
// ============================================================

// ---- Lista amici ----

function getFriends(token) {
  try {
    requireAuth(token);
    var sheet = getSheet('FRIENDS');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, items: [] };

    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var items = [];
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      items.push({
        friend_id: String(data[i][0]),
        nickname:  String(data[i][1]),
        sheet_id:  String(data[i][2])
      });
    }
    return { success: true, items: items };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Aggiunge amico ----

function addFriend(token, nickname, sheetId) {
  try {
    requireAuth(token);

    if (!nickname || !sheetId) {
      return { success: false, error: 'Nickname e Sheet ID sono obbligatori.' };
    }

    // Verifica che lo sheet sia accessibile prima di salvarlo
    try {
      SpreadsheetApp.openById(sheetId);
    } catch (ex) {
      return { success: false, error: 'Sheet ID non valido o non accessibile. Assicurati che il foglio sia pubblico.' };
    }

    // Controlla duplicati per sheet_id
    var sheet = getSheet('FRIENDS');
    var existing = sheet.getDataRange().getValues();
    for (var i = 1; i < existing.length; i++) {
      if (String(existing[i][2]) === String(sheetId)) {
        return { success: false, error: 'Questo Sheet ID è già presente nella lista amici.' };
      }
    }

    var id = generateUuid();
    sheet.appendRow([id, nickname, sheetId]);
    return { success: true, friend_id: id };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Elimina amico ----

function deleteFriend(token, friendId) {
  try {
    requireAuth(token);
    var sheet = getSheet('FRIENDS');
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(friendId)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: 'Amico non trovato.' };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Legge portfolio di un amico ----
// Legge il foglio PORTFOLIO dallo sheet esterno dell'amico (deve essere pubblico).
// Arricchisce i dati usando la CACHE_CARDS locale (tua).

function getFriendPortfolio(token, sheetId) {
  try {
    requireAuth(token);

    if (!sheetId) return { success: false, error: 'Sheet ID mancante.' };

    // Apre lo sheet dell'amico
    var friendSS;
    try {
      friendSS = SpreadsheetApp.openById(sheetId);
    } catch (ex) {
      return { success: false, error: 'Impossibile accedere allo sheet. Assicurati che sia pubblico.' };
    }

    var portfolioSheet = friendSS.getSheetByName('PORTFOLIO');
    if (!portfolioSheet) {
      return { success: false, error: 'Foglio PORTFOLIO non trovato nello sheet dell\'amico.' };
    }

    var lastRow = portfolioSheet.getLastRow();
    if (lastRow <= 1) return { success: true, items: [], cards: [] };

    var data = portfolioSheet.getRange(1, 1, lastRow, 9).getValues();
    var startRow = (data[0][0] === 'portfolio_id') ? 1 : 0;

    var items = [];
    for (var i = startRow; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      items.push({
        portfolio_id: String(row[0]),
        card_id:      String(row[1]),
        quantity:     Number(row[2]),
        condition:    String(row[3]),
        language:     String(row[4]),
        finish:       String(row[5]),
        date_added:   String(row[6]),
        blueprint_id: row[7] ? Number(row[7]) : null,
        last_price:   row[8] !== '' && row[8] !== null && row[8] !== undefined ? Number(row[8]) : null
      });
    }

    // Costruisce lista di card_id unici presenti nel portfolio amico
    var cardIds = {};
    items.forEach(function(item) { cardIds[item.card_id] = true; });

    // Legge la CACHE_CARDS locale per arricchire con nome, immagine, set ecc.
    var cardSheet = getSheet('CACHE_CARDS');
    var cardData = cardSheet.getDataRange().getValues();
    var cardMap = {};
    for (var j = 1; j < cardData.length; j++) {
      var r = cardData[j];
      if (r[0] && cardIds[r[0]]) {
        cardMap[r[0]] = {
          id:              String(r[0]),
          name:            String(r[1]),
          set_id:          String(r[2]),
          set_name:        String(r[3]),
          set_series:      String(r[4]),
          number:          String(r[5]),
          rarity:          String(r[6]),
          types:           String(r[7]),
          image_url_small: String(r[8]),
          image_url_large: String(r[9]),
          set_logo_url:    String(r[10])
        };
      }
    }

    return {
      success: true,
      items: items,
      cards: cardMap
    };

  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}
