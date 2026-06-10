// ============================================================
// Friends.gs - Lista utenti dal foglio master (sola lettura)
// ============================================================

function getFriends(token) {
  try {
    requireAuth(token);

    var currentUsername = getSessionUsername(token);
    var master = getMasterSheet();
    var data = master.getDataRange().getValues();

    var items = [];
    for (var i = 0; i < data.length; i++) {
      var username = String(data[i][0] || '').trim();
      var sheetId = String(data[i][2] || '').trim();

      if (!username || !sheetId) continue;
      if (username.toLowerCase() === currentUsername.toLowerCase()) continue;

      items.push({
        username: username,
        sheet_id: sheetId
      });
    }

    return { success: true, items: items };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

function getFriendPortfolio(token, sheetId) {
  try {
    requireAuth(token);

    if (!sheetId) return { success: false, error: 'Sheet ID mancante.' };

    var master = getMasterSheet();
    var masterData = master.getDataRange().getValues();
    var isRegistered = false;
    for (var m = 0; m < masterData.length; m++) {
      if (String(masterData[m][2]).trim() === sheetId.trim()) {
        isRegistered = true;
        break;
      }
    }
    if (!isRegistered) {
      return { success: false, error: 'Utente non trovato nel sistema.' };
    }

    var friendSS;
    try {
      friendSS = SpreadsheetApp.openById(sheetId);
    } catch (ex) {
      return { success: false, error: 'Impossibile accedere allo sheet.' };
    }

    var portfolioSheet = friendSS.getSheetByName('PORTFOLIO');
    if (!portfolioSheet) {
      return { success: false, error: 'Foglio PORTFOLIO non trovato.' };
    }

    var lastRow = portfolioSheet.getLastRow();
    if (lastRow <= 1) return { success: true, items: [], cards: {} };

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

    var cardIds = {};
    items.forEach(function(item) { cardIds[item.card_id] = true; });

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

    return { success: true, items: items, cards: cardMap };

  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}
